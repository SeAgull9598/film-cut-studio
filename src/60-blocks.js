/* =========================================================================
 * 拉片台 LaPian Studio — 60 blocks
 * Notion 式块编辑器 + 本地语音记录
 * 对应需求：
 *   R-019 块编辑器：文本/标题/列表/待办/引用/Callout/分隔线 + `/` 命令菜单
 *         + 行内富文本（加粗/斜体/高亮/行内代码）+ Markdown 快捷输入 + 拖拽排序
 *   R-020 语音块：MediaRecorder 本地录音 → IndexedDB；Web Speech 本地实时转写；
 *         回放原音频；不支持时优雅降级。全程无任何云端转写请求（P1 素材不出机）
 *   R-021 记录按镜头/时间码关联：顶部显示宿主、插入当前时间码、点击时间码跳转、
 *         「摘要回填」把第一段结论写回 sevenQ / 段落组 analysis
 * ========================================================================= */
LP.blocks = (function () {
  const U = LP.util, el = U.el;

  /* ====================================================== 类型定义 R-019 */
  /* ph = 空块占位提示（配合 styles.css 的 .blk-c:empty::before[data-ph]） */
  const TYPES = [
    { type: 'text', ic: '¶', name: '文本', desc: '普通段落', ph: '写点什么，或按 / 唤起命令', kw: 'text wenben zhengwen duanluo p 文本 正文 段落' },
    { type: 'h1', ic: 'H1', name: '标题 1', desc: '一级标题', ph: '标题', kw: 'h1 biaoti bt title heading da 标题 大标题 一级' },
    { type: 'h2', ic: 'H2', name: '标题 2', desc: '二级标题', ph: '小标题', kw: 'h2 biaoti bt subtitle heading xiao 标题 小标题 二级' },
    { type: 'list', ic: '•', name: '无序列表', desc: '要点罗列', ph: '列表项', kw: 'list liebiao lb ul bullet yaodian 列表 无序 要点 罗列' },
    { type: 'todo', ic: '☑', name: '待办', desc: '可勾选任务', ph: '待办事项', kw: 'todo daiban db task check checkbox 待办 任务 复选 勾选' },
    { type: 'quote', ic: '❝', name: '引用', desc: '引述台词 / 原文', ph: '引用一句台词或原文', kw: 'quote yinyong yy taici 引用 引述 台词 原文' },
    { type: 'callout', ic: '▣', name: 'Callout', desc: '高亮提示块', ph: '这一镜最要紧的一句', kw: 'callout gaoliang gl tishi zhongdian 高亮 提示 标注 重点 强调' },
    { type: 'divider', ic: '—', name: '分隔线', desc: '分段', ph: '', kw: 'divider fengexian fgx hr line 分隔线 分割线 横线 分段' },
    { type: 'voice', ic: '●', name: '语音记录', desc: '本地录音 + 实时转写', ph: '转写文本会出现在这里，可直接修改', kw: 'voice yuyin yy luyin ly record koushu zhuanxie 语音 录音 口述 转写' }
  ];
  const TMAP = {};
  TYPES.forEach(t => { TMAP[t.type] = t; });

  /* 类型 → styles.css 中已有的块样式类 */
  const CLS = {
    text: '', h1: 'blk-h1', h2: 'blk-h2', quote: 'blk-quote', callout: 'blk-callout',
    list: 'blk-li', todo: 'blk-todo', divider: 'blk-divider', voice: 'blk-voice'
  };

  /* `/` 菜单条目 = 全部块类型 + 若干动作命令 */
  const CMDS = [
    { cmd: 'tc', ic: '⏱', name: '插入当前时间码', desc: '把播放头时间写进正文', kw: 'tc timecode shijianma sjm time 时间码 时间 定位 跳转' },
    { cmd: 'digest', ic: '⇪', name: '摘要回填七问', desc: '第一段结论写回字段', kw: 'digest zhaiyao zy huitian ht sevenq 摘要 回填 结论 七问' }
  ];

  /* Markdown 快捷输入（R-019）；顺序敏感：## 必须先于 # */
  const MD = [
    [/^##\s/, 'h2'], [/^#\s/, 'h1'],
    [/^[-*]\s/, 'list'],
    [/^\[\]\s/, 'todo'], [/^\[\s\]\s/, 'todo'],
    [/^>\s/, 'quote']
  ];

  /* ========================================================== 模块状态 */
  let cur = { container: null, owner: null, ownerId: null, kind: 'shot', label: '' };
  let lastC = null;              // 最近获得焦点的 .blk-c（插入时间码用）
  let dTimer = null;             // 输入防抖 400ms
  let suppress = false;          // 自己 commit 时抑制 change 重绘
  let dragId = null;             // 拖拽中的块 id
  let inited = false;
  let slash = null;              // { blockId, c, pos, menu, items, idx }
  let rec = null;                // 录音会话
  let audio = null;              // { a, url } 当前回放
  let composing = false;         // 输入法合成中

  /* ====================================================== XSS 清洗 */
  /* 只保留 b/i/strong/em/mark/code/br/span；span 只保留白名单 class 与 data-t。
   * 其余标签一律拆壳保留文本；script/style 等直接丢弃。*/
  const ALLOW = { B: 1, I: 1, STRONG: 1, EM: 1, MARK: 1, CODE: 1, BR: 1, SPAN: 1 };
  const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1 };
  const CLASS_OK = { tcref: 1, chip: 1, dim: 1 };

  function sanitize(html) {
    const box = document.createElement('div');
    box.innerHTML = String(html == null ? '' : html);
    scrub(box);
    return box.innerHTML;
  }
  function scrub(node) {
    const kids = Array.prototype.slice.call(node.childNodes);
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) continue;                       // 文本节点保留
      if (n.nodeType !== 1) { n.parentNode.removeChild(n); continue; }   // 注释等丢弃
      const tag = n.tagName;
      if (DROP[tag]) { n.parentNode.removeChild(n); continue; }
      scrub(n);
      if (!ALLOW[tag]) {                                    // 不认识的标签：拆壳留文本
        const p = n.parentNode;
        while (n.firstChild) p.insertBefore(n.firstChild, n);
        p.removeChild(n);
        continue;
      }
      const attrs = Array.prototype.slice.call(n.attributes);
      for (let j = 0; j < attrs.length; j++) {
        const nm = attrs[j].name.toLowerCase();
        let keep = false;
        if (tag === 'SPAN') {
          if (nm === 'class') {
            const ok = attrs[j].value.split(/\s+/).filter(t => CLASS_OK[t]);
            if (ok.length) { n.setAttribute('class', ok.join(' ')); keep = true; }
          } else if (nm === 'data-t') {
            keep = /^\d+(\.\d+)?$/.test(attrs[j].value);
          }
        }
        if (!keep) n.removeAttribute(attrs[j].name);        // on* / style / href 等全部剥掉
      }
    }
  }
  function plain(html) {
    const d = document.createElement('div');
    d.innerHTML = sanitize(html || '');
    return (d.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  /* ====================================================== 光标工具 */
  function caretOffset(c) {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return 0;
    const r0 = s.getRangeAt(0);
    if (!c.contains(r0.endContainer)) return 0;
    const r = document.createRange();
    r.selectNodeContents(c);
    r.setEnd(r0.endContainer, r0.endOffset);
    return r.toString().length;
  }
  function setCaret(c, off) {
    if (!c) return;
    c.focus();
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
    let n, acc = 0, target = null, to = 0;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      if (acc + len >= off) { target = n; to = Math.max(0, off - acc); break; }
      acc += len;
    }
    const r = document.createRange();
    if (target) { r.setStart(target, Math.min(to, target.nodeValue.length)); r.collapse(true); }
    else { r.selectNodeContents(c); r.collapse(false); }
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
  function rangeOfOffsets(c, from, to) {
    const r = document.createRange();
    r.selectNodeContents(c);
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
    let n, acc = 0, gotStart = false;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      if (!gotStart && acc + len >= from) { r.setStart(n, from - acc); gotStart = true; }
      if (acc + len >= to) { r.setEnd(n, to - acc); return r; }
      acc += len;
    }
    return r;
  }
  function caretRect() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).cloneRange();
    let rc = r.getBoundingClientRect();
    if (rc && (rc.top || rc.height)) return rc;
    const mark = document.createElement('span');
    mark.appendChild(document.createTextNode('\u200b'));
    try { r.insertNode(mark); } catch (e) { return null; }
    rc = mark.getBoundingClientRect();
    const p = mark.parentNode;
    if (p) { p.removeChild(mark); p.normalize(); }
    return rc;
  }
  function collapsed() {
    const s = window.getSelection();
    return !s || !s.rangeCount || s.getRangeAt(0).collapsed;
  }

  /* ====================================================== 数据小工具 */
  function blocks() { return (cur.owner && cur.owner.blocks) || []; }
  function idxOf(b) { return blocks().indexOf(b); }
  function nodeOf(id) { return cur.container ? cur.container.querySelector('.blk[data-id="' + id + '"]') : null; }
  function blockOfNode(n) {
    const host = n && n.closest ? n.closest('.blk') : null;
    if (!host) return null;
    const id = host.getAttribute('data-id');
    return blocks().find(b => b.id === id) || null;
  }
  function editing() {
    const a = document.activeElement;
    return !!(a && cur.container && cur.container.contains(a) && a.classList && a.classList.contains('blk-c'));
  }
  /** 结构性变更后统一收尾 */
  function commit(label) {
    suppress = true;
    try { LP.state.commit(label); } finally { suppress = false; }
  }
  /** 文本编辑：400ms 防抖，且不 push（push 只给结构性操作） */
  function commitSoon() {
    clearTimeout(dTimer);
    dTimer = setTimeout(() => commit('编辑记录'), 400);
  }
  function flush() { if (dTimer) { clearTimeout(dTimer); dTimer = null; commit('编辑记录'); } }

  /* ====================================================== 播放器桥接 R-021 */
  function nowTime() {
    let t = null;
    try { if (LP.player && typeof LP.player.time === 'function') t = LP.player.time(); } catch (e) { }
    if (t == null || !isFinite(t)) {
      const v = document.querySelector('#video');
      t = v ? v.currentTime : 0;
    }
    return isFinite(t) && t > 0 ? t : 0;
  }
  function seekTo(sec) {
    try { if (LP.player && typeof LP.player.seek === 'function') { LP.player.seek(sec); return true; } } catch (e) { }
    const v = document.querySelector('#video');
    if (v) { try { v.currentTime = sec; return true; } catch (e) { } }
    return false;
  }

  /* ====================================================== 渲染 */
  function render(container, owner, ownerLabel) {
    if (!inited) init();
    stopRec(true);
    closeSlash();
    cur.container = container || null;
    cur.owner = owner || null;
    cur.ownerId = owner ? owner.id : null;
    cur.kind = owner && owner.memberShotIds ? 'group' : 'shot';
    cur.label = ownerLabel || '';
    lastC = null;
    paint();
  }

  function paint() {
    const box = cur.container;
    if (!box) return;
    box.innerHTML = '';
    if (!cur.owner) {
      box.appendChild(el('div', {
        class: 'insp-empty',
        html: '未选中片段<br><small>在时间线或媒体池里点一个镜头 / 段落组，<br>这里就是它的分析记录本</small>'
      }));
      return;
    }
    if (!Array.isArray(cur.owner.blocks)) cur.owner.blocks = [];
    /* 永远保留一个可写的空块，行为贴近 Notion（不落 undo 栈） */
    if (!cur.owner.blocks.length) cur.owner.blocks.push(LP.model.newBlock('text', ''));

    box.appendChild(buildOwnerBar());
    box.appendChild(buildToolBar());
    const list = el('div', { 'data-blocks': '1' });
    cur.owner.blocks.forEach(b => list.appendChild(buildBlock(b)));
    box.appendChild(list);
  }

  /* R-021 顶部：这段记录挂在哪个镜头 / 段落组上 */
  function buildOwnerBar() {
    const bar = el('div', { class: 'blk-tools' });
    bar.appendChild(el('span', { class: 'badge', text: cur.kind === 'group' ? '段落组' : '镜头' }));
    bar.appendChild(el('span', { class: 'pool-tc', text: cur.label || '（未提供定位信息）' }));
    return bar;
  }

  function buildToolBar() {
    const bar = el('div', { class: 'blk-tools' });
    bar.appendChild(el('button', {
      class: 'btn xs', title: '在末尾追加一个文本块', text: '+ 文本块',
      onclick: () => addBlock('text')
    }));
    bar.appendChild(el('button', {
      class: 'btn xs', title: 'R-020 本地录音 + 实时转写，音频只存在本机', text: '+ 语音块',
      onclick: () => addBlock('voice')
    }));
    bar.appendChild(el('button', {
      class: 'btn xs', title: 'R-021 插入播放头当前时间码，点击时间码可跳转', text: '⏱ 插入时间码',
      onclick: insertTC
    }));
    bar.appendChild(el('button', {
      class: 'btn xs', title: '块=论证，字段=结论：把第一段文字写回结论字段', text: '⇪ 摘要回填',
      onclick: digest
    }));
    bar.appendChild(el('span', { class: 'pool-tc', text: '/ 唤起命令 · ⌘B 粗 ⌘I 斜 ⌘H 高亮 ⌘E 代码' }));
    return bar;
  }

  /* ---------------------------------------------------- 单块 DOM */
  function buildBlock(b) {
    const node = el('div', { class: ('blk ' + (CLS[b.type] || '')).trim(), 'data-id': b.id });

    const handle = el('span', { class: 'blk-handle', title: '按住拖拽可调整顺序', text: '⠿' });
    handle.setAttribute('draggable', 'true');
    node.appendChild(handle);

    if (b.type === 'divider') {
      node.appendChild(el('hr'));
    } else if (b.type === 'voice') {
      node.appendChild(buildVoice(b));
    } else {
      if (b.type === 'list') node.appendChild(el('span', { class: 'bullet', text: '•' }));
      if (b.type === 'todo') {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!b.checked;
        cb.addEventListener('change', () => {
          LP.state.push();
          b.checked = cb.checked;
          commit('勾选待办');
          const c = node.querySelector('.blk-c');
          if (c) c.style.textDecoration = cb.checked ? 'line-through' : '';
        });
        node.appendChild(cb);
      }
      const c = buildEditable(b);
      if (b.type === 'todo' && b.checked) c.style.textDecoration = 'line-through';
      node.appendChild(c);
    }

    node.appendChild(el('button', {
      class: 'blk-del', title: '删除这一块', text: '✕',
      onclick: () => removeBlock(b)
    }));

    bindDrag(node, b, handle);
    return node;
  }

  function buildEditable(b) {
    const t = TMAP[b.type] || TMAP.text;
    const c = el('div', { class: 'blk-c', contenteditable: 'true', spellcheck: 'false', 'data-ph': t.ph });
    c.innerHTML = sanitize(b.content);
    c.addEventListener('input', () => onInput(b, c));
    c.addEventListener('focus', () => { lastC = c; });
    c.addEventListener('blur', () => { composing = false; flush(); });
    /* 中文输入法：合成期间不做 Markdown 判定 / 斜杠菜单，避免拼音串被误识别 */
    c.addEventListener('compositionstart', () => { composing = true; });
    c.addEventListener('compositionend', () => { composing = false; onInput(b, c); });
    c.addEventListener('paste', e => {           // 只收纯文本，杜绝外部 HTML 混入
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, txt);
    });
    return c;
  }

  /* ====================================================== 输入处理 R-019 */
  function onInput(b, c) {
    if (c.innerHTML === '<br>' || c.innerHTML === '<div><br></div>') { c.innerHTML = ''; setCaret(c, 0); }
    b.content = sanitize(c.innerHTML);
    if (b.type === 'voice') b.transcript = plain(b.content);
    if (composing) { commitSoon(); return; }
    if (mdShortcut(b, c)) return;          // Markdown 命中后已重建该块
    if (slash) updateSlash();
    commitSoon();
  }

  /** Markdown 行首快捷输入 */
  function mdShortcut(b, c) {
    if (b.type !== 'text') return false;
    const txt = c.textContent || '';
    if (txt === '---' || txt === '***') { toDivider(b); return true; }
    for (let i = 0; i < MD.length; i++) {
      const m = txt.match(MD[i][0]);
      if (m) { changeType(b, MD[i][1], txt.slice(m[0].length)); return true; }
    }
    return false;
  }

  /** 换类型；rawText 传入时用纯文本覆盖内容（Markdown / 斜杠命令场景） */
  function changeType(b, type, rawText) {
    LP.state.push();
    b.type = type;
    if (rawText != null) b.content = U.esc(rawText);
    if (type === 'voice') b.content = b.content || '';
    commit('切换块类型');
    const node = replaceNode(b);
    const c = node ? node.querySelector('.blk-c') : null;
    if (c) setCaret(c, rawText != null ? rawText.length : (c.textContent || '').length);
  }

  function toDivider(b) {
    LP.state.push();
    b.type = 'divider'; b.content = '';
    const nb = LP.model.newBlock('text', '');
    cur.owner.blocks.splice(idxOf(b) + 1, 0, nb);
    commit('插入分隔线');
    paint();
    focusBlock(nb.id, 'start');
  }

  function replaceNode(b) {
    const old = nodeOf(b.id);
    if (!old) { paint(); return nodeOf(b.id); }
    const fresh = buildBlock(b);
    old.parentNode.replaceChild(fresh, old);
    return fresh;
  }

  function focusBlock(id, where) {
    const n = nodeOf(id);
    const c = n ? n.querySelector('.blk-c') : null;
    if (!c) return false;
    setCaret(c, where === 'start' ? 0 : (c.textContent || '').length);
    return true;
  }

  /* ====================================================== 键盘 */
  /* 这些键在编辑器内不应冒泡给全局快捷键；Escape 只在斜杠菜单打开时拦截 */
  const STOP_KEYS = { Enter: 1, Backspace: 1, Delete: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Home: 1, End: 1, Tab: 1 };

  function onDocKeydown(e) {
    const c = e.target && e.target.closest ? e.target.closest('.blk-c') : null;
    if (!c || !cur.container || !cur.container.contains(c)) return;
    const b = blockOfNode(c);
    if (!b) return;
    onKeydown(e, b, c);
  }

  function onKeydown(e, b, c) {
    /* 编辑器内的按键不应触发全局快捷键（空格播放 / Del 删片段 / ⌘B 拆分…） */
    if (STOP_KEYS[e.key] || (e.key.length === 1 && !e.metaKey && !e.ctrlKey)) e.stopPropagation();
    /* 输入法合成中（选字、回车确认候选）一律放行，否则会误建块 */
    if (e.isComposing || e.keyCode === 229 || composing) return;

    if (slash && slashKey(e)) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.length === 1) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); e.stopPropagation(); fmt('bold'); return; }
      if (k === 'i') { e.preventDefault(); e.stopPropagation(); fmt('italic'); return; }
      if (k === 'h') { e.preventDefault(); e.stopPropagation(); fmt('mark'); return; }
      if (k === 'e') { e.preventDefault(); e.stopPropagation(); fmt('code'); return; }
      return;
    }

    if (e.key === '/') { setTimeout(() => openSlash(b, c), 0); return; }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(b, c); return; }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      b.content = sanitize(c.innerHTML); commitSoon();
      return;
    }
    if (e.key === 'Backspace' && collapsed() && caretOffset(c) === 0) { e.preventDefault(); onBackspace(b, c); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp';
      if (!edgeLine(c, up)) return;
      const sib = siblingEditable(b, up);
      if (sib) { e.preventDefault(); setCaret(sib, up ? (sib.textContent || '').length : 0); }
    }
  }

  function edgeLine(c, up) {
    const cr = caretRect();
    if (!cr) return true;
    const er = c.getBoundingClientRect();
    return up ? (cr.top - er.top < 6) : (er.bottom - cr.bottom < 6);
  }
  function siblingEditable(b, up) {
    const arr = blocks();
    let i = arr.indexOf(b);
    if (i < 0) return null;
    for (i += up ? -1 : 1; i >= 0 && i < arr.length; i += up ? -1 : 1) {
      const n = nodeOf(arr[i].id);
      const c = n ? n.querySelector('.blk-c') : null;
      if (c) return c;
    }
    return null;
  }

  /** Enter：在块末尾新建下一块；在中间则拆分 */
  function onEnter(b, c) {
    const arr = cur.owner.blocks;
    const txt = c.textContent || '';
    /* 空的列表 / 待办按 Enter 退回普通文本（Notion 行为） */
    if (!txt && (b.type === 'list' || b.type === 'todo')) { changeType(b, 'text', ''); return; }

    const off = caretOffset(c);
    let tail = '';
    if (off < txt.length) {
      const r = rangeOfOffsets(c, off, txt.length);
      const tmp = document.createElement('div');
      tmp.appendChild(r.extractContents());
      tail = sanitize(tmp.innerHTML);
    }
    LP.state.push();
    b.content = sanitize(c.innerHTML);
    const keep = { list: 1, todo: 1, quote: 1, callout: 1 };
    const nb = LP.model.newBlock(keep[b.type] ? b.type : 'text', tail);
    arr.splice(idxOf(b) + 1, 0, nb);
    commit('新建块');

    const host = nodeOf(b.id);
    const fresh = buildBlock(nb);
    if (host && host.parentNode) host.parentNode.insertBefore(fresh, host.nextSibling);
    else paint();
    focusBlock(nb.id, 'start');
  }

  /** Backspace 在块首：非文本块先降级为文本；空块删除并聚焦上一块末尾；有内容则并入上一块 */
  function onBackspace(b, c) {
    const arr = cur.owner.blocks, i = idxOf(b);
    if (b.type === 'voice') return;                       // 语音块只能用 ✕ 删除，避免误删音频
    if (b.type !== 'text') {                              // 先降级成普通文本，保留行内格式
      LP.state.push();
      b.type = 'text';
      commit('切换块类型');
      const node = replaceNode(b);
      const nc = node ? node.querySelector('.blk-c') : null;
      if (nc) setCaret(nc, 0);
      return;
    }
    if (i <= 0) return;

    const prev = arr[i - 1];
    if (prev.type === 'divider') {                        // 直接吃掉上面的分隔线
      LP.state.push();
      arr.splice(i - 1, 1);
      commit('删除分隔线');
      const pn = nodeOf(prev.id); if (pn) pn.remove();
      setCaret(c, 0);
      return;
    }
    const pn = nodeOf(prev.id);
    const pc = pn ? pn.querySelector('.blk-c') : null;
    if (!pc || prev.type === 'voice') {
      if (!(c.textContent || '')) { removeBlock(b, true); focusBlock(prev.id, 'end'); }
      return;
    }
    const off = (pc.textContent || '').length;
    LP.state.push();
    prev.content = sanitize((pc.innerHTML || '') + (c.innerHTML || ''));
    arr.splice(i, 1);
    commit('合并块');
    pc.innerHTML = sanitize(prev.content);
    const n = nodeOf(b.id); if (n) n.remove();
    setCaret(pc, off);
  }

  /* ====================================================== 增删 */
  function addBlock(type, after) {
    if (!cur.owner) return U.toast('先选中一个镜头或段落组', 'err');
    const arr = cur.owner.blocks;
    LP.state.push();
    const nb = LP.model.newBlock(type, '');
    const at = after ? idxOf(after) + 1 : arr.length;
    arr.splice(at, 0, nb);
    commit('新建块');
    paint();
    if (!focusBlock(nb.id, 'end')) {
      const n = nodeOf(nb.id); if (n) n.scrollIntoView({ block: 'nearest' });
    }
  }

  function removeBlock(b, quiet) {
    const arr = cur.owner ? cur.owner.blocks : null;
    if (!arr) return;
    const i = arr.indexOf(b);
    if (i < 0) return;
    if (rec && rec.blockId === b.id) stopRec(true);
    if (b.audioRef) { try { LP.storage.delBlob(b.audioRef); } catch (e) { } }   // 连音频一起清掉
    LP.state.push();
    arr.splice(i, 1);
    if (!arr.length) arr.push(LP.model.newBlock('text', ''));
    commit('删除块');
    const focusId = arr[Math.max(0, i - 1)] ? arr[Math.max(0, i - 1)].id : null;
    paint();
    if (!quiet && focusId) focusBlock(focusId, 'end');
  }

  /* ====================================================== 拖拽排序 R-019 */
  function bindDrag(node, b, handle) {
    handle.addEventListener('dragstart', e => {
      dragId = b.id;
      node.style.opacity = '.45';
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', b.id);
        e.dataTransfer.setDragImage(node, 12, 10);
      } catch (err) { }
    });
    handle.addEventListener('dragend', () => {
      dragId = null; node.style.opacity = ''; clearMarks();
    });
    node.addEventListener('dragover', e => {
      if (!dragId || dragId === b.id) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      clearMarks();
      node.style.boxShadow = before ? 'inset 0 2px 0 var(--accent)' : 'inset 0 -2px 0 var(--accent)';
      node.setAttribute('data-drop', before ? 'before' : 'after');
    });
    node.addEventListener('dragleave', () => {
      node.style.boxShadow = ''; node.removeAttribute('data-drop');
    });
    node.addEventListener('drop', e => {
      e.preventDefault();
      const where = node.getAttribute('data-drop') || 'before';
      clearMarks();
      moveBlock(dragId, b.id, where === 'after');
      dragId = null;
    });
  }
  function clearMarks() {
    if (!cur.container) return;
    U.$$('.blk[data-drop]', cur.container).forEach(n => { n.style.boxShadow = ''; n.removeAttribute('data-drop'); });
  }
  function moveBlock(fromId, toId, after) {
    if (!fromId || fromId === toId || !cur.owner) return;
    const arr = cur.owner.blocks;
    const fi = arr.findIndex(x => x.id === fromId);
    if (fi < 0) return;
    LP.state.push();
    const item = arr.splice(fi, 1)[0];
    let ti = arr.findIndex(x => x.id === toId);
    if (ti < 0) ti = arr.length - 1;
    arr.splice(after ? ti + 1 : ti, 0, item);
    commit('调整块顺序');
    paint();
  }

  /* ====================================================== 行内格式 R-019 */
  function fmt(kind) {
    if (kind === 'bold' || kind === 'italic') {
      /* 关掉 styleWithCSS，让加粗/斜体产出 <b>/<i> 标签而不是 style（style 会被 sanitize 剥掉） */
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { }
      try { document.execCommand(kind); } catch (e) { }
    } else {
      wrapToggle(kind === 'mark' ? 'mark' : 'code');
    }
    const c = document.activeElement;
    if (c && c.classList && c.classList.contains('blk-c')) {
      const b = blockOfNode(c);
      if (b) { b.content = sanitize(c.innerHTML); commitSoon(); }
    }
  }
  function wrapToggle(tag) {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    const host = closestC(r.commonAncestorContainer);
    if (!host) return;
    const hit = closestTag(r.commonAncestorContainer, tag, host);
    if (hit) {                                  // 已在标签内 → 取消格式
      const p = hit.parentNode;
      while (hit.firstChild) p.insertBefore(hit.firstChild, hit);
      p.removeChild(hit); p.normalize();
      return;
    }
    if (r.collapsed) { U.toast('先选中要格式化的文字'); return; }
    const w = document.createElement(tag);
    try { w.appendChild(r.extractContents()); r.insertNode(w); } catch (e) { return; }
    const nr = document.createRange();
    nr.selectNodeContents(w);
    s.removeAllRanges(); s.addRange(nr);
  }
  function closestC(n) {
    while (n) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('blk-c')) return n;
      n = n.parentNode;
    }
    return null;
  }
  function closestTag(n, tag, stop) {
    tag = tag.toUpperCase();
    while (n && n !== stop) {
      if (n.nodeType === 1 && n.tagName === tag) return n;
      n = n.parentNode;
    }
    return null;
  }

  /* ====================================================== 斜杠命令菜单 R-019 */
  function openSlash(b, c) {
    closeSlash();
    if (!c.isConnected) return;
    const pos = caretOffset(c) - 1;
    if (pos < 0 || (c.textContent || '').charAt(pos) !== '/') return;
    const menu = el('div', { class: 'slash-menu' });
    document.body.appendChild(menu);
    slash = { blockId: b.id, c: c, pos: pos, menu: menu, items: [], idx: 0 };
    updateSlash();
  }
  function closeSlash() {
    if (slash && slash.menu && slash.menu.parentNode) slash.menu.parentNode.removeChild(slash.menu);
    slash = null;
  }
  function updateSlash() {
    if (!slash) return;
    const c = slash.c;
    if (!c.isConnected) return closeSlash();
    const txt = c.textContent || '';
    const co = caretOffset(c);
    if (co <= slash.pos || txt.charAt(slash.pos) !== '/') return closeSlash();
    const q = txt.slice(slash.pos + 1, co);
    if (/\s/.test(q)) return closeSlash();
    const items = TYPES.concat(CMDS).filter(it => match(it, q.toLowerCase()));
    if (!items.length) return closeSlash();
    slash.items = items;
    if (slash.idx >= items.length) slash.idx = 0;
    paintSlash();
  }
  function match(it, q) {
    if (!q) return true;
    const hay = (it.name + ' ' + it.desc + ' ' + it.kw).toLowerCase();
    if (hay.indexOf(q) >= 0) return true;
    let i = 0;                                   // 模糊：子序列匹配（bt → biaoti）
    for (let k = 0; k < hay.length && i < q.length; k++) if (hay.charAt(k) === q.charAt(i)) i++;
    return i >= q.length;
  }
  function paintSlash() {
    const m = slash.menu;
    m.innerHTML = '';
    slash.items.forEach((it, i) => {
      const row = el('div', { class: 'slash-item' + (i === slash.idx ? ' on' : '') }, [
        el('span', { class: 'si-ic', text: it.ic }),
        el('span', { text: it.name }),
        el('span', { class: 'si-d', text: it.desc })
      ]);
      row.addEventListener('mousedown', e => { e.preventDefault(); applySlash(it); });
      m.appendChild(row);
    });
    const act = m.children[slash.idx];
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    const r = caretRect();
    const w = 210, h = Math.min(280, m.scrollHeight || 200);
    let x = r ? r.left : 240, y = r ? r.bottom + 4 : 200;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    if (y + h > window.innerHeight - 8) y = Math.max(8, (r ? r.top : y) - h - 4);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }
  function slashKey(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); return true; }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const n = slash.items.length;
      slash.idx = (slash.idx + (k === 'ArrowDown' ? 1 : -1) + n) % n;
      paintSlash();
      return true;
    }
    if (k === 'Enter' || k === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      applySlash(slash.items[slash.idx]);
      return true;
    }
    return false;
  }
  function applySlash(it) {
    if (!slash || !it) return;
    const c = slash.c, pos = slash.pos;
    const b = blocks().find(x => x.id === slash.blockId);
    closeSlash();
    if (!b || !c.isConnected) return;
    /* 抹掉 "/query" 这段文字 */
    const co = caretOffset(c);
    if (co > pos) {
      const r = rangeOfOffsets(c, pos, co);
      r.deleteContents();
    }
    b.content = sanitize(c.innerHTML);
    setCaret(c, pos);

    if (it.cmd === 'tc') { insertTC(); return; }
    if (it.cmd === 'digest') { digest(); return; }
    if (it.type === 'divider') { toDivider(b); return; }
    if (it.type === 'voice') { toVoice(b); return; }
    if (it.type === b.type) { commitSoon(); return; }

    LP.state.push();
    b.type = it.type;
    commit('切换块类型');
    const node = replaceNode(b);
    const nc = node ? node.querySelector('.blk-c') : null;
    if (nc) setCaret(nc, pos);
  }
  function toVoice(b) {
    const arr = cur.owner.blocks;
    LP.state.push();
    let target = b;
    if (b.type === 'text' && !plain(b.content)) { b.type = 'voice'; b.content = ''; }
    else { target = LP.model.newBlock('voice', ''); arr.splice(idxOf(b) + 1, 0, target); }
    commit('插入语音块');
    paint();
    const n = nodeOf(target.id);
    if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
  }

  /* ====================================================== 时间码 R-021 */
  function insertTC() {
    if (!cur.owner) return U.toast('先选中一个镜头或段落组', 'err');
    const t = nowTime();
    const html = '<span class="tcref chip dim" data-t="' + t.toFixed(3) + '">[' + U.tc(t) + ']</span>&nbsp;';
    let c = document.activeElement;
    if (!(c && c.classList && c.classList.contains('blk-c') && cur.container.contains(c))) c = lastC;
    if (!c || !c.isConnected || !cur.container.contains(c)) {
      LP.state.push();
      const nb = LP.model.newBlock('text', html);
      cur.owner.blocks.push(nb);
      commit('插入时间码');
      paint();
      focusBlock(nb.id, 'end');
    } else {
      c.focus();
      document.execCommand('insertHTML', false, html);
      const b = blockOfNode(c);
      if (b) { b.content = sanitize(c.innerHTML); commitSoon(); }
    }
    U.toast('已插入时间码 ' + U.tc(t));
  }
  function onDocClick(e) {
    const tgt = e.target;
    if (slash && slash.menu && !slash.menu.contains(tgt)) closeSlash();
    const ref = tgt && tgt.closest ? tgt.closest('.tcref') : null;
    if (!ref || !cur.container || !cur.container.contains(ref)) return;
    const t = parseFloat(ref.getAttribute('data-t'));
    if (!isFinite(t)) return;
    if (seekTo(t)) U.toast('跳到 ' + U.tc(t));
  }

  /* ====================================================== 摘要回填 R-021 */
  /* 「块=论证，字段=结论」：把第一段纯文本写回结论字段 */
  function digest() {
    const o = cur.owner;
    if (!o) return U.toast('先选中一个镜头或段落组', 'err');
    let text = '';
    const arr = o.blocks || [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].type === 'divider') continue;
      const s = plain(arr[i].content) || (arr[i].transcript || '').trim();
      if (s) { text = s; break; }
    }
    if (!text) return U.toast('还没有可回填的文字', 'err');
    const key = cur.kind === 'group' ? 'analysis' : 'sevenQ';
    const name = cur.kind === 'group' ? '段落组分析' : '七问分析';
    if ((o[key] || '').trim()) return U.toast(name + '已有内容，未覆盖', 'err');
    LP.state.push();
    o[key] = text;
    commit('摘要回填');
    U.toast('已回填到「' + name + '」', 'ok');
  }

  /* ====================================================== 语音块 R-020 */
  function buildVoice(b) {
    /* .blk 是横向 flex，语音块需要纵向排布，这里用一个最小内联样式包一层 */
    const box = el('div', { style: 'flex:1;min-width:0' });
    const bar = el('div', { class: 'v-bar' });

    const btnRec = el('button', { class: 'btn xs', text: '● 录音', title: 'MediaRecorder 本地录音，音频只写入本机 IndexedDB，不上传' });
    const dot = el('span', { class: 'rec-dot' });
    dot.hidden = true;
    const timer = el('span', { class: 'pool-tc', text: '00:00' });
    const btnPlay = el('button', { class: 'btn xs', text: '▶ 回放', title: '从本机读取音频回放' });
    btnPlay.disabled = !b.audioRef;
    const stat = el('span', { text: b.audioRef ? '已录制 · 本机存储' : '未录制' });

    bar.appendChild(btnRec); bar.appendChild(dot); bar.appendChild(timer);
    bar.appendChild(btnPlay); bar.appendChild(stat);
    box.appendChild(bar);

    const c = buildEditable(b);
    box.appendChild(c);

    const ui = { btnRec: btnRec, dot: dot, timer: timer, btnPlay: btnPlay, stat: stat, c: c };
    btnRec.addEventListener('click', () => {
      if (rec && rec.blockId === b.id) stopRec();
      else startRec(b, ui);
    });
    btnPlay.addEventListener('click', () => playVoice(b, btnPlay));
    if (rec && rec.blockId === b.id) rec.ui = ui;      // 重绘后重新接上 UI
    return box;
  }

  function srSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  function startRec(b, ui) {
    if (rec) { U.toast('已有语音块正在录音'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      U.toast('当前浏览器不支持本地录音，建议使用 Chrome', 'err');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      let mr;
      try { mr = new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); U.toast('录音器初始化失败', 'err'); return; }

      rec = { blockId: b.id, block: b, ui: ui, mr: mr, stream: stream, chunks: [], sr: null, live: true, finalTxt: '', t0: Date.now(), timer: null };
      mr.addEventListener('dataavailable', e => { if (e.data && e.data.size) rec.chunks.push(e.data); });
      mr.addEventListener('stop', finishRec);
      try { mr.start(); } catch (e) { rec = null; stream.getTracks().forEach(t => t.stop()); U.toast('无法开始录音', 'err'); return; }

      ui.btnRec.textContent = '■ 停止';
      ui.btnRec.classList.add('accent');
      ui.dot.hidden = false;
      ui.btnPlay.disabled = true;
      ui.stat.textContent = '录音中…';
      rec.timer = setInterval(() => {
        if (!rec || !rec.ui) return;
        const s = Math.floor((Date.now() - rec.t0) / 1000);
        rec.ui.timer.textContent = U.pad(s / 60) + ':' + U.pad(s % 60);
      }, 250);

      startSR(ui);
    }).catch(err => {
      U.toast('无法访问麦克风：' + ((err && err.name) || '已被拒绝'), 'err');
    });
  }

  /* 本地实时转写：只用浏览器内置 Web Speech，不接任何云端转写 API（P1） */
  function startSR(ui) {
    if (!srSupported()) {
      rec.noSR = true;
      ui.stat.textContent = '当前浏览器不支持本地实时转写，可先录音，稍后手动补写（Chrome 支持最好）';
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let sr;
    try { sr = new SR(); } catch (e) { rec.noSR = true; return; }
    sr.lang = 'zh-CN';
    sr.continuous = true;
    sr.interimResults = true;
    sr.addEventListener('result', e => {
      if (!rec) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) rec.finalTxt += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (rec.ui && rec.ui.c && rec.ui.c.isConnected) rec.ui.c.textContent = rec.finalTxt + interim;
    });
    sr.addEventListener('error', ev => {
      if (!rec || !rec.ui) return;
      const code = ev && ev.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') rec.ui.stat.textContent = '转写被拒绝，仅录音（稍后可手动补写）';
      else if (code === 'no-speech') rec.ui.stat.textContent = '没听到声音…';
    });
    sr.addEventListener('end', () => {                 // 长录音时浏览器会自动断，续上
      if (rec && rec.live && rec.sr === sr) { try { sr.start(); } catch (e) { } }
    });
    try { sr.start(); rec.sr = sr; } catch (e) { rec.noSR = true; }
  }

  function stopRec(silent) {
    if (!rec) return;
    rec.live = false;
    rec.silent = !!silent;
    clearInterval(rec.timer);
    if (rec.sr) { try { rec.sr.stop(); } catch (e) { } }
    try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); else finishRec(); }
    catch (e) { finishRec(); }
  }

  function finishRec() {
    const v = rec;
    if (!v || v.done) return;
    v.done = true;
    rec = null;
    try { v.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
    const b = v.block, ui = v.ui;
    const alive = ui && ui.c && ui.c.isConnected;
    const blob = new Blob(v.chunks, { type: (v.mr && v.mr.mimeType) || 'audio/webm' });
    const txt = (v.finalTxt || '').trim();

    const done = () => {
      LP.state.push();
      if (txt) { b.transcript = txt; b.content = U.esc(txt); }   // 转写回填到 transcript 与 content
      commit('语音记录');
      if (alive) {
        if (txt) ui.c.innerHTML = sanitize(b.content);
        resetVoiceUI(ui, b, v);
      }
    };

    if (!blob.size) {
      if (alive) ui.stat.textContent = v.noSR ? '没录到声音（也不支持本地转写）' : '没录到声音';
      if (txt) done(); else if (alive) resetVoiceUI(ui, b, v);
      return;
    }
    const key = b.audioRef || ('voice_' + b.id);
    Promise.resolve(LP.storage.putBlob(key, blob)).then(ok => {
      if (ok) b.audioRef = key;
      done();
      if (!ok) U.toast('音频写入本地库失败，转写文本已保留', 'err');
    });
  }

  function resetVoiceUI(ui, b, v) {
    ui.btnRec.textContent = '● 录音';
    ui.btnRec.classList.remove('accent');
    ui.dot.hidden = true;
    ui.btnPlay.disabled = !b.audioRef;
    if (v && v.noSR) ui.stat.textContent = '已录音 · 本浏览器不支持本地转写，请手动补写（Chrome 支持最好）';
    else ui.stat.textContent = b.audioRef ? '已录制 · 本机存储' : '未录制';
  }

  function playVoice(b, btn) {
    if (audio) {
      try { audio.a.pause(); } catch (e) { }
      URL.revokeObjectURL(audio.url);
      const prev = audio; audio = null;
      if (prev.btn) prev.btn.textContent = '▶ 回放';
      if (prev.id === b.id) return;                 // 再点一次 = 停止
    }
    if (!b.audioRef) return U.toast('这个语音块还没有录音', 'err');
    Promise.resolve(LP.storage.getBlob(b.audioRef)).then(blob => {
      if (!blob) return U.toast('本机音频已丢失', 'err');
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio = { a: a, url: url, btn: btn, id: b.id };
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (audio && audio.url === url) audio = null;
        if (btn) btn.textContent = '▶ 回放';
      };
      a.addEventListener('ended', cleanup);
      a.addEventListener('error', cleanup);
      a.play().then(() => { if (btn) btn.textContent = '■ 停止'; }).catch(() => { cleanup(); U.toast('回放失败', 'err'); });
    });
  }

  /* ====================================================== 外部变更同步 */
  function onExtChange() {
    if (suppress || !cur.container || !cur.ownerId) return;
    if (!document.contains(cur.container)) return;
    if (rec) return;                       // 录音中不重绘，避免打断
    if (editing()) return;                 // 正在输入不重绘，避免打断焦点
    const fresh = cur.kind === 'group' ? LP.state.group(cur.ownerId) : LP.state.shot(cur.ownerId);
    if (!fresh) { cur.owner = null; paint(); return; }
    const changed = fresh !== cur.owner ||
      (Array.isArray(fresh.blocks) ? fresh.blocks.length : 0) !== cur.container.querySelectorAll('.blk').length;
    cur.owner = fresh;
    if (changed) paint();
  }

  /* ====================================================== init */
  function init() {
    if (inited) return;
    inited = true;
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { }   // 让加粗产出 <b> 而不是 style
    document.addEventListener('keydown', onDocKeydown, true);
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('scroll', () => { if (slash) closeSlash(); }, true);
    LP.bus.on('change', onExtChange);
  }

  /* 供报告/素材包模块取纯文本（R-022 会用到） */
  function toText(list) {
    return (list || []).map(b => {
      const t = plain(b.content) || (b.transcript || '');
      if (b.type === 'divider') return '---';
      if (b.type === 'h1') return '# ' + t;
      if (b.type === 'h2') return '## ' + t;
      if (b.type === 'list') return '- ' + t;
      if (b.type === 'todo') return (b.checked ? '- [x] ' : '- [ ] ') + t;
      if (b.type === 'quote') return '> ' + t;
      if (b.type === 'callout') return '【重点】' + t;
      if (b.type === 'voice') return '（口述）' + t;
      return t;
    }).filter(s => s !== '').join('\n');
  }

  return { render: render, init: init, sanitize: sanitize, toText: toText };
})();
