/* =========================================================================
 * 拉片台 LaPian Studio — 00 core
 * 命名空间 / 工具 / 事件总线 / 字段定义 / 数据模型 / 撤销栈 / 本地持久化
 * 对应需求：R-008(虚拟片段) R-015(字段类型) R-016(七维) R-025(本地保存) P1(本地优先)
 * ========================================================================= */
window.LP = window.LP || {};

/* ---------------------------------------------------------------- util */
LP.util = (function () {
  const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');

  /** 秒 -> HH:MM:SS:FF 时间码 */
  function tc(sec, fps) {
    fps = fps || (LP.state && LP.state.project.meta.fps) || 25;
    if (!isFinite(sec) || sec < 0) sec = 0;
    const f = Math.round((sec - Math.floor(sec)) * fps);
    let s = Math.floor(sec), ff = f;
    if (ff >= fps) { ff = 0; s += 1; }
    return pad(s / 3600) + ':' + pad((s % 3600) / 60) + ':' + pad(s % 60) + ':' + pad(ff);
  }
  /** 秒 -> 0.0s / 1:03.2 人类可读时长 */
  function dur(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    if (sec < 60) return sec.toFixed(1) + 's';
    return Math.floor(sec / 60) + ':' + pad(sec % 60) + '.' + Math.floor((sec % 1) * 10);
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let _seq = 0;
  const uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + '_' + (_seq++).toString(36);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  /** 纯本地下载，不经过任何服务器 */
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob(['\ufeff' + content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { }
      ta.remove(); return ok;
    }
  }
  function toast(msg, type) {
    let box = $('#lp-toast');
    if (!box) { box = el('div', { id: 'lp-toast' }); document.body.appendChild(box); }
    const t = el('div', { class: 'toast ' + (type || ''), text: msg });
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
  }
  return { tc, dur, clamp, uid, clone, esc, $, $$, el, download, copy, toast, pad };
})();

/* ----------------------------------------------------------------- bus */
LP.bus = (function () {
  const map = {};
  return {
    on(ev, fn) { (map[ev] = map[ev] || []).push(fn); return () => LP.bus.off(ev, fn); },
    off(ev, fn) { if (map[ev]) map[ev] = map[ev].filter(f => f !== fn); },
    emit(ev, payload) { (map[ev] || []).forEach(f => { try { f(payload); } catch (e) { console.error('[bus:' + ev + ']', e); } }); }
  };
})();
/* 事件约定：
 *  project:loaded  工程/视频载入完成
 *  change          任何工程数据变更（commit 后）  payload:{label}
 *  selection       选择变化 payload:{shotIds,groupId}
 *  time            播放时间更新 payload:{t}
 *  page            页面切换 payload:'cut'|'table'|'report'
 */

/* -------------------------------------------------------------- FIELDS */
/* R-015 字段类型：select 单选 / multi 多选 / text 单行 / longtext 多行
 *                 attachment 附件(关键帧) / relation 关联(到组) / formula 公式(时长)
 * R-016 声画派七维度 + R-026 每字段"看什么/怎么写"提示卡
 */
LP.FIELDS = [
  {
    key: 'size', name: '景别', dim: 1, type: 'select', width: 88,
    options: ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'],
    colors: { '大远景': '#3d5a80', '远景': '#4a7fa5', '全景': '#4f9d8f', '中景': '#7a9e4a', '近景': '#c49a3f', '特写': '#d1743c', '大特写': '#c2504e' },
    watch: '人物在画面里占多大？头顶到胸口，还是只剩一只眼睛？',
    write: '先写景别，再写它跟上一镜的关系：远→中→特 是逼近，特→全 是抽离。',
    demo: '「上一镜全景交代环境，这镜切近景，观众被推到他脸前，逃不掉。」'
  },
  {
    key: 'sizeNote', name: '递进关系', dim: 1, type: 'text', width: 160,
    watch: '这一镜比上一镜更近还是更远？递进是连续的还是跳跃的？',
    write: '写"从什么到什么，为了什么"。',
    demo: '「全→中→特三级推进，情绪跟着收紧，到特写时他刚好说不出话。」'
  },
  {
    key: 'move', name: '运镜', dim: 2, type: 'multi', width: 130,
    options: ['固定', '推', '拉', '摇', '移', '跟', '升降', '手持', '变焦', '环绕'],
    watch: '镜头本身动没动？往哪动？速度快慢？',
    write: '固定不是没设计，固定=让观众盯住。动就要问"为什么这时候动"。',
    demo: '「缓推，慢到几乎察觉不到，等他说到那句话时刚好到位。」'
  },
  {
    key: 'moveWhy', name: '运镜意图', dim: 2, type: 'longtext', width: 200,
    watch: '这个动作让观众的注意力被带到哪？情绪是被推近还是被拉开？',
    write: '写"这样动 → 观众感到什么"，不要只描述动作。',
    demo: '「推=逼近情绪，拉=抽离旁观，跟=与人物同呼吸。」'
  },
  {
    key: 'blocking', name: '场面调度', dim: 3, type: 'longtext', width: 200,
    watch: '机位在哪？人物怎么走？前景/后景各有什么？谁挡着谁？',
    write: '写空间关系与权力关系：谁在画面中心、谁被边缘化。',
    demo: '「机位放低，人物在画右三分线，左侧留大片空，空的地方就是缺席的人。」'
  },
  {
    key: 'light', name: '光色', dim: 4, type: 'longtext', width: 180,
    watch: '光从哪来？冷还是暖？亮部暗部怎么分？皮肤是什么颜色？',
    write: '写光的来源+色温+心理暗示，别只写"很好看"。',
    demo: '「侧逆光，暖调压低，半张脸埋进阴影——他没说的那一半。」'
  },
  {
    key: 'sound', name: '声音设计', dim: 5, type: 'longtext', width: 200,
    watch: '同期声/音乐/音效/静默各占多少？先入声还是先入画？',
    write: '闭眼再听一遍。声音先到还是画面先到，决定了观众怎么进入这场戏。',
    demo: '「音乐在他停顿的第二秒才进来，不抢话，只托住那口气。」'
  },
  {
    key: 'soundRel', name: '声画关系', dim: 5, type: 'select', width: 96,
    options: ['同步', '对位', '错位', '留白', '声先入', '声延续'],
    colors: { '同步': '#4a7fa5', '对位': '#c49a3f', '错位': '#c2504e', '留白': '#6b7280', '声先入': '#4f9d8f', '声延续': '#7a5fa5' },
    watch: '声音和画面说的是同一件事吗？',
    write: '同步=互相印证；对位=互相反衬；错位=声音属于另一时空；留白=故意不给。',
    demo: '「画面是现在的他，声音是二十年前的口令——错位，回忆压过现实。」'
  },
  {
    key: 'cut', name: '剪辑点', dim: 6, type: 'longtext', width: 180,
    watch: '为什么在这一帧切？前一镜的最后一个动作完成了没有？',
    write: '写"切在什么动作/什么声音上"，以及早切或晚切带来的感觉差。',
    demo: '「切在他抬眼之前半秒，观众来不及看清，疑问被留下。」'
  },
  {
    key: 'cutType', name: '切换方式', dim: 6, type: 'select', width: 96,
    options: ['硬切', '叠化', '匹配剪辑', '跳切', '划像', '黑场', '声音过渡'],
    colors: { '硬切': '#4a7fa5', '叠化': '#7a5fa5', '匹配剪辑': '#4f9d8f', '跳切': '#c2504e', '划像': '#c49a3f', '黑场': '#6b7280', '声音过渡': '#d1743c' },
    watch: '两镜之间是干脆切开，还是溶在一起？',
    write: '硬切=推进，叠化=时间流逝或心理关联，跳切=焦躁，匹配剪辑=形状/动作接力。',
    demo: '「叠化两秒，让旧照片长在他脸上。」'
  },
  {
    key: 'sevenQ', name: '七问分析', dim: 7, type: 'longtext', width: 240,
    watch: '综合看：这一镜让观众离人物更近了，还是更远了？',
    write: '一句话结论 + 一句话理由。这是这一镜存在的理由。',
    demo: '「更近。因为镜头替观众做了那个"忍不住想凑上去看"的动作。」'
  },
  { key: 'thumb', name: '关键帧', dim: 0, type: 'attachment', width: 76, watch: '可选附件，截图只是备注，不是分析本体（P3）。', write: '点"抓帧"从当前画面取一张。', demo: '' },
  { key: 'groupId', name: '所属段落组', dim: 0, type: 'relation', width: 120, watch: '这一镜属于哪个段落组。', write: '在时间线选中相邻片段按 G 编组。', demo: '' },
  { key: 'duration', name: '时长', dim: 0, type: 'formula', width: 80, watch: '公式字段：out − in，自动计算。', write: '', demo: '' }
];
LP.FIELD_MAP = {};
LP.FIELDS.forEach(f => { LP.FIELD_MAP[f.key] = f; });
/* 七维度分组（检查器折叠区用） */
LP.DIMS = [
  { dim: 1, name: '1 景别递进', icon: '◱' },
  { dim: 2, name: '2 运镜意图', icon: '⇢' },
  { dim: 3, name: '3 场面调度', icon: '⊞' },
  { dim: 4, name: '4 光色', icon: '◐' },
  { dim: 5, name: '5 声音设计', icon: '♪' },
  { dim: 6, name: '6 剪辑点', icon: '✂' },
  { dim: 7, name: '7 七问分析', icon: '?' }
];

/* --------------------------------------------------------------- model */
LP.model = {
  newShot(inSec, outSec) {
    const s = { id: LP.util.uid('shot'), in: +inSec.toFixed(3), out: +outSec.toFixed(3), groupId: null, blocks: [], thumb: null };
    LP.FIELDS.forEach(f => {
      if (f.type === 'multi') s[f.key] = [];
      else if (['select', 'text', 'longtext'].indexOf(f.type) >= 0) s[f.key] = '';
    });
    return s;
  },
  newGroup(name, memberIds) {
    return { id: LP.util.uid('grp'), name: name || '未命名段落', memberShotIds: memberIds.slice(), analysis: '', blocks: [], color: null };
  },
  newBlock(type, content) {
    return { id: LP.util.uid('blk'), type: type || 'text', content: content || '', transcript: '', audioRef: null, checked: false };
  },
  emptyProject() {
    return {
      videoRef: null,          // {name,size,type,duration,w,h,idbKey}
      videoRatio: 'other',     // '16:9' | '9:16' | 'other'
      shots: [], groups: [],
      meta: { title: '未命名拉片工程', createdAt: Date.now(), updatedAt: Date.now(), fps: 25, note: '' }
    };
  }
};

/* --------------------------------------------------------------- state */
LP.state = (function () {
  let project = LP.model.emptyProject();
  let selection = { shotIds: [], groupId: null };
  const undoStack = [], redoStack = [];
  const MAX_UNDO = 60;

  function snapshot() { return JSON.stringify({ shots: project.shots, groups: project.groups, meta: project.meta }); }
  function restore(json) {
    const d = JSON.parse(json);
    project.shots = d.shots; project.groups = d.groups; project.meta = d.meta;
  }

  const api = {
    get project() { return project; },
    get selection() { return selection; },

    /** 取排好序的片段 */
    shots() { return project.shots.slice().sort((a, b) => a.in - b.in); },
    shot(id) { return project.shots.find(s => s.id === id) || null; },
    group(id) { return project.groups.find(g => g.id === id) || null; },
    /** 当前主选中片段 */
    current() { return selection.shotIds.length ? api.shot(selection.shotIds[selection.shotIds.length - 1]) : null; },
    currentGroup() { return selection.groupId ? api.group(selection.groupId) : null; },
    groupShots(gid) { return api.shots().filter(s => s.groupId === gid); },

    /** 变更前调用：压入撤销快照 */
    push() { undoStack.push(snapshot()); if (undoStack.length > MAX_UNDO) undoStack.shift(); redoStack.length = 0; },

    /** 变更后调用：落盘 + 广播 */
    commit(label) {
      project.meta.updatedAt = Date.now();
      LP.storage.saveSoon();
      LP.bus.emit('change', { label: label || '' });
    },
    undo() {
      if (!undoStack.length) return LP.util.toast('没有可撤销的操作');
      redoStack.push(snapshot());
      restore(undoStack.pop());
      selection.shotIds = selection.shotIds.filter(id => api.shot(id));
      if (selection.groupId && !api.group(selection.groupId)) selection.groupId = null;
      api.commit('撤销'); LP.bus.emit('selection', selection);
      LP.util.toast('已撤销');
    },
    redo() {
      if (!redoStack.length) return LP.util.toast('没有可重做的操作');
      undoStack.push(snapshot());
      restore(redoStack.pop());
      api.commit('重做'); LP.bus.emit('selection', selection);
      LP.util.toast('已重做');
    },
    select(shotIds, groupId, opts) {
      selection.shotIds = (shotIds || []).slice();
      selection.groupId = groupId || null;
      LP.bus.emit('selection', Object.assign({}, selection, opts || {}));
    },
    setProject(p) {
      project = p; undoStack.length = 0; redoStack.length = 0;
      selection = { shotIds: [], groupId: null };
      LP.bus.emit('project:loaded', project);
      LP.bus.emit('change', { label: 'load' });
    }
  };
  return api;
})();

/* ------------------------------------------------------------- storage
 * P1 本地优先：工程 JSON -> localStorage；视频 Blob -> IndexedDB
 * 全程无任何网络请求
 */
LP.storage = (function () {
  const LS_KEY = 'lapian.project.v2';
  const DB_NAME = 'lapian-db', STORE = 'media';
  let dbp = null, timer = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    }).catch(e => { console.warn('IndexedDB 不可用，视频将不会被缓存：', e); return null; });
    return dbp;
  }
  async function putBlob(key, blob) {
    const d = await db(); if (!d) return false;
    return new Promise(res => {
      try {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = () => res(true); tx.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }
  async function getBlob(key) {
    const d = await db(); if (!d) return null;
    return new Promise(res => {
      try {
        const tx = d.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function delBlob(key) {
    const d = await db(); if (!d) return;
    try { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); } catch (e) { }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(LP.state.project));
      const dot = LP.util.$('#saveDot'); if (dot) { dot.classList.add('on'); setTimeout(() => dot.classList.remove('on'), 700); }
    } catch (e) { console.warn('工程保存失败（可能超出 localStorage 配额）', e); }
  }
  function saveSoon() { clearTimeout(timer); timer = setTimeout(save, 400); }
  function load() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(LS_KEY); } catch (e) { } }
  return { save, saveSoon, load, clear, putBlob, getBlob, delBlob };
})();
