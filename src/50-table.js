/* =========================================================================
 * 拉片台 LaPian Studio — 50 多维表格模块
 * R-014 一镜一行·逐行可编辑   R-015 七种字段类型   R-016 声画派七维度+表头提示
 * R-017 四视图（表格/看板/画廊/表单）   R-018 搜索/筛选/分组/排序
 * 传统 script（非 ES module），全部挂到 LP.table；只定义 init，不自动执行。
 * 隐私 P1：无任何网络请求，缩略图一律走本地 dataURL。
 * ========================================================================= */
window.LP = window.LP || {};

LP.table = (function () {
  'use strict';

  const U = LP.util;
  const el = U.el;

  /* ------------------------------------------------------------ 模块状态 */
  let inited = false;
  let view = 'grid';                 // grid | kanban | gallery | form
  let elTabs = null, elTools = null, elBody = null, elPage = null;
  let popEl = null;                  // 选项浮层
  let formIdx = 0;                   // R-017 表单视图当前条序号
  let selfCommit = false;            // 自己提交的变更，避免 change 回调把正在编辑的 DOM 冲掉

  /* R-018 查询条件 */
  const q = {
    kw: '',            // 关键词
    fkey: '',          // 筛选字段 key
    fval: '',          // 筛选值（'__empty' 空值 / '__none' 未分组）
    grp: 'none',       // 分组：none | size | soundRel | cutType | groupId
    sortKey: 'in',     // 排序：in | duration | size
    sortAsc: true,
    onlyGroup: false   // 仅看当前段落组
  };

  const TYPE_CN = {
    select: '单选', multi: '多选', text: '文本', longtext: '长文',
    attachment: '附件', relation: '关联', formula: '公式'
  };

  /* ------------------------------------------------------------ 小工具 */
  function visible() { return !!elPage && !elPage.hasAttribute('hidden'); }

  /** 提交自己发起的数据变更（不触发本模块整体重绘） */
  function softCommit(label) {
    selfCommit = true;
    try { LP.state.commit(label || '编辑维度'); } finally { selfCommit = false; }
  }

  /** 深色底判定：给彩色 chip 挑一个能看清的字色（不引入新配色） */
  function fgOf(hex) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return '#10131a';
    const r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10131a' : '#f3f6fa';
  }

  /** 单选/多选值 -> 带色 chip（颜色取 field.colors[value]） */
  function chipEl(field, val) {
    const c = el('span', { class: 'chip', text: val });          // textContent 写入，防 XSS
    const col = field.colors && field.colors[val];
    if (col) { c.style.background = col; c.style.color = fgOf(col); }
    else c.classList.add('dim');
    return c;
  }

  function optionEl(text, value) { return el('option', { value: value != null ? value : text, text: text }); }

  function emptyBox(main, sub) {
    const n = el('div', { class: 'insp-empty' }, [document.createTextNode(main)]);
    if (sub) { n.appendChild(el('br')); n.appendChild(el('small', { text: sub })); }
    return n;
  }

  function shotIndexMap() {
    const m = {};
    LP.state.shots().forEach((s, i) => { m[s.id] = i + 1; });
    return m;
  }

  function groupName(gid) {
    const g = gid ? LP.state.group(gid) : null;
    return g ? g.name : '';
  }

  /** 当前段落组：优先显式选中的组，其次当前镜头所属组 */
  function curGroupId() {
    if (LP.state.selection.groupId) return LP.state.selection.groupId;
    const s = LP.state.current();
    return s && s.groupId ? s.groupId : null;
  }

  function durOf(s) { return Math.max(0, (s.out || 0) - (s.in || 0)); }

  /* ------------------------------------------------ R-018 搜索/筛选/排序 */
  function searchText(s) {
    const parts = [];
    LP.FIELDS.forEach(f => {
      const v = s[f.key];
      if (f.type === 'multi') parts.push((v || []).join(' '));
      else if (f.type === 'relation') parts.push(groupName(v));
      else if (['select', 'text', 'longtext'].indexOf(f.type) >= 0) parts.push(v || '');
    });
    (s.blocks || []).forEach(b => parts.push(b.content || ''));
    parts.push(U.tc(s.in));
    return parts.join('\u0001').toLowerCase();
  }

  function matchFilter(s) {
    if (!q.fkey || !q.fval) return true;
    const f = LP.FIELD_MAP[q.fkey];
    if (!f) return true;
    if (f.type === 'multi') {
      const arr = s[f.key] || [];
      return q.fval === '__empty' ? !arr.length : arr.indexOf(q.fval) >= 0;
    }
    if (f.type === 'relation') return q.fval === '__none' ? !s.groupId : s.groupId === q.fval;
    return q.fval === '__empty' ? !s[f.key] : s[f.key] === q.fval;
  }

  function sizeRank(s) {
    const f = LP.FIELD_MAP.size;
    const i = f.options.indexOf(s.size);
    return i < 0 ? 999 : i;
  }

  /** 当前筛选 + 排序后的镜头数组（导出 CSV 模块会调用） */
  function currentRows() {
    let rows = LP.state.shots();
    const kw = q.kw.trim().toLowerCase();
    if (kw) rows = rows.filter(s => searchText(s).indexOf(kw) >= 0);
    rows = rows.filter(matchFilter);
    if (q.onlyGroup) {
      const gid = curGroupId();
      if (gid) rows = rows.filter(s => s.groupId === gid);
    }
    const dir = q.sortAsc ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      let d = 0;
      if (q.sortKey === 'duration') d = durOf(a) - durOf(b);
      else if (q.sortKey === 'size') d = sizeRank(a) - sizeRank(b);
      else d = a.in - b.in;
      return d !== 0 ? d * dir : (a.in - b.in);
    });
    return rows;
  }

  /** R-018 分组：返回 [{key,name,rows}] */
  function groupRows(rows) {
    if (q.grp === 'none') return [{ key: '', name: '', rows: rows }];
    const buckets = {}, order = [];
    function bucket(k, name) {
      if (!buckets[k]) { buckets[k] = { key: k, name: name, rows: [] }; order.push(k); }
      return buckets[k];
    }
    if (q.grp === 'groupId') {
      LP.state.project.groups.forEach(g => bucket(g.id, g.name));
      bucket('__none', '未分组');
      rows.forEach(s => bucket(s.groupId || '__none', s.groupId ? groupName(s.groupId) : '未分组').rows.push(s));
    } else {
      const f = LP.FIELD_MAP[q.grp];
      (f.options || []).forEach(o => bucket(o, o));
      bucket('__empty', '未填写');
      rows.forEach(s => { const v = s[q.grp] || '__empty'; bucket(v, v === '__empty' ? '未填写' : v).rows.push(s); });
    }
    return order.map(k => buckets[k]).filter(b => b.rows.length);
  }

  /* ------------------------------------------------------ 选项浮层（弹层） */
  function closePop() {
    if (!popEl) return;
    popEl.remove(); popEl = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onPopKey, true);
  }
  function onDocDown(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function onPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }

  /**
   * 单选/多选/关联 的浮层编辑器
   * items: [{value,label,color}]，multi=true 时可多选且浮层保持打开
   */
  function openPop(anchor, items, isMulti, getVals, onPick) {
    closePop();
    const box = el('div', { class: 'slash-menu', style: 'width:auto;min-width:158px;max-width:280px;padding:7px' });
    const wrap = el('div', { class: 'opts' });
    items.forEach(it => {
      const b = el('button', { class: 'opt', type: 'button', text: it.label });
      function paint() {
        const on = getVals().indexOf(it.value) >= 0;
        b.classList.toggle('on', on);
        if (on && it.color) { b.style.background = it.color; b.style.color = fgOf(it.color); }
        else if (on) { b.style.background = 'var(--accent)'; b.style.color = '#10131a'; }
        else { b.style.background = ''; b.style.color = ''; }
      }
      paint();
      b.addEventListener('click', () => {
        onPick(it.value);
        if (isMulti) paint(); else closePop();   // 多选：就地刷新、浮层保持打开
      });
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
    if (isMulti) {
      const ft = el('div', { style: 'margin-top:7px;text-align:right' });
      ft.appendChild(el('button', { class: 'btn xs', type: 'button', text: '完成', onclick: closePop }));
      box.appendChild(ft);
    }
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - bw - 10);
    let top = r.bottom + 4;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 4);
    box.style.left = Math.max(8, left) + 'px';
    box.style.top = top + 'px';
    popEl = box;
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onPopKey, true);
  }

  /* --------------------------------------------------------- 数据写入口 */
  function setValue(shotId, key, val, label) {
    const t0 = LP.state.shot(shotId);
    if (!t0) return false;
    LP.state.push();                       // 先压撤销栈
    const t = LP.state.shot(shotId);
    t[key] = val;
    softCommit(label || '编辑维度');
    return true;
  }

  function toggleMulti(shotId, key, val) {
    const s = LP.state.shot(shotId);
    if (!s) return [];
    const arr = (s[key] || []).slice();
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else arr.push(val);
    setValue(shotId, key, arr, '编辑多选');
    return arr;
  }

  /* ------------------------------------------------- R-015 单元格渲染器 */
  function cellText(f, s) {
    const td = el('td');
    const c = el('div', {
      class: 'cell', contenteditable: 'plaintext-only', spellcheck: 'false',
      title: f.type === 'longtext' ? 'Enter 换行 / Esc 撤销本次编辑' : 'Enter 提交 / Esc 撤销本次编辑'
    });
    c.textContent = s[f.key] || '';                       // textContent 读写，防 XSS
    let orig = c.textContent;
    c.addEventListener('focus', () => { orig = c.textContent; });
    c.addEventListener('blur', () => {
      const v = c.textContent.replace(/\u00a0/g, ' ');
      if (v === orig) return;
      if (!setValue(s.id, f.key, v, '编辑' + f.name)) { c.textContent = orig; return; }
      orig = v;
    });
    c.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); c.textContent = orig; c.blur(); }
      else if (e.key === 'Enter' && (f.type === 'text' || e.metaKey || e.ctrlKey)) { e.preventDefault(); c.blur(); }
    });
    td.appendChild(c);
    return td;
  }

  function cellSelect(f, s) {
    const td = el('td');
    const c = el('div', { class: 'cell', title: '点击选择' + f.name, style: 'cursor:pointer' });
    function paint() {
      c.textContent = '';
      const v = LP.state.shot(s.id) ? LP.state.shot(s.id)[f.key] : s[f.key];
      if (v) c.appendChild(chipEl(f, v));
      else c.appendChild(el('span', { style: 'color:var(--txt3)', text: '—' }));
    }
    paint();
    c.addEventListener('click', () => {
      const items = [{ value: '', label: '（清空）' }].concat(
        (f.options || []).map(o => ({ value: o, label: o, color: f.colors && f.colors[o] })));
      openPop(c, items, false,
        () => [LP.state.shot(s.id) ? (LP.state.shot(s.id)[f.key] || '') : ''],
        v => { setValue(s.id, f.key, v, '编辑' + f.name); paint(); refreshIfAffects(f.key); });
    });
    td.appendChild(c);
    return td;
  }

  function cellMulti(f, s) {
    const td = el('td');
    const c = el('div', { class: 'cell', title: '点击切换' + f.name, style: 'cursor:pointer;display:flex;flex-wrap:wrap;gap:3px' });
    function paint() {
      c.textContent = '';
      const cur = LP.state.shot(s.id) ? (LP.state.shot(s.id)[f.key] || []) : [];
      if (!cur.length) c.appendChild(el('span', { style: 'color:var(--txt3)', text: '—' }));
      else cur.forEach(v => c.appendChild(chipEl(f, v)));
    }
    paint();
    c.addEventListener('click', () => {
      const items = (f.options || []).map(o => ({ value: o, label: o, color: f.colors && f.colors[o] }));
      openPop(c, items, true,
        () => (LP.state.shot(s.id) ? (LP.state.shot(s.id)[f.key] || []) : []),
        v => { toggleMulti(s.id, f.key, v); paint(); });
    });
    td.appendChild(c);
    return td;
  }

  function cellAttachment(f, s) {
    const td = el('td');
    const c = el('div', { class: 'cell', style: 'padding:3px 5px' });
    if (s.thumb) {
      const img = el('img', {
        src: s.thumb, alt: '关键帧', title: '关键帧（本地 dataURL）',
        style: 'width:60px;height:auto;max-height:52px;object-fit:contain;background:#000;border-radius:3px;display:block'
      });
      c.appendChild(img);
    } else {
      c.appendChild(el('span', { style: 'color:var(--txt3)', text: '—' }));
    }
    td.appendChild(c);
    return td;
  }

  function cellRelation(f, s) {
    const td = el('td');
    const c = el('div', { class: 'cell', title: '点击关联段落组', style: 'cursor:pointer' });
    function paint() {
      c.textContent = '';
      const cur = LP.state.shot(s.id);
      const gid = cur ? cur.groupId : s.groupId;
      if (gid && LP.state.group(gid)) {
        const chip = el('span', { class: 'chip', text: groupName(gid) });
        const col = LP.state.group(gid).color || '#6b4f8f';
        chip.style.background = col; chip.style.color = fgOf(col);
        c.appendChild(chip);
      } else c.appendChild(el('span', { style: 'color:var(--txt3)', text: '未分组' }));
    }
    paint();
    c.addEventListener('click', () => {
      const items = [{ value: '', label: '（未分组）' }].concat(
        LP.state.project.groups.map(g => ({ value: g.id, label: g.name, color: g.color || '#6b4f8f' })));
      openPop(c, items, false,
        () => [LP.state.shot(s.id) ? (LP.state.shot(s.id).groupId || '') : ''],
        v => { setValue(s.id, 'groupId', v || null, '编辑所属段落组'); paint(); refreshIfAffects('groupId'); });
    });
    td.appendChild(c);
    return td;
  }

  function cellFormula(f, s) {
    const td = el('td');
    td.appendChild(el('div', {
      class: 'cell', title: '公式字段：out − in，自动计算（只读）',
      style: 'font-family:var(--mono);color:var(--txt2)', text: U.dur(durOf(s))
    }));
    return td;
  }

  function cellFor(f, s) {
    switch (f.type) {
      case 'select': return cellSelect(f, s);
      case 'multi': return cellMulti(f, s);
      case 'attachment': return cellAttachment(f, s);
      case 'relation': return cellRelation(f, s);
      case 'formula': return cellFormula(f, s);
      default: return cellText(f, s);
    }
  }

  /** 改到的字段正好是当前分组/筛选/排序依据时，需要整表重排 */
  function refreshIfAffects(key) {
    if (q.grp === key || q.fkey === key || (q.sortKey === 'size' && key === 'size')) render();
    else syncTools(currentRows().length);
  }

  /* ------------------------------------------------------ R-017 表格视图 */
  function renderGrid(rows) {
    const frag = document.createDocumentFragment();      // 一次性 DOM 构建
    const table = el('table', { class: 'grid' });
    const idxMap = shotIndexMap();
    const selIds = LP.state.selection.shotIds || [];

    /* 表头：R-016 表头挂字段提示 */
    const thead = el('thead');
    const trh = el('tr');
    const th0 = el('th', { class: 'c-idx', text: '# / 时间码' });
    trh.appendChild(th0);
    LP.FIELDS.forEach(f => {
      const th = el('th', { style: 'min-width:' + f.width + 'px' });
      const box = el('div', { class: 'th-t' });
      box.appendChild(el('span', { text: f.name }));
      box.appendChild(el('span', {
        text: TYPE_CN[f.type] || f.type,
        style: 'font-size:9.5px;color:var(--txt3);border:1px solid var(--line2);padding:0 3px;border-radius:2px;font-weight:400'
      }));
      th.appendChild(box);
      try { if (window.LP.help && LP.help.attachHint) LP.help.attachHint(th, f); } catch (e) { }
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = el('tbody');
    const colCount = LP.FIELDS.length + 1;
    groupRows(rows).forEach(bucket => {
      if (q.grp !== 'none') {                            // R-018 分组标题行
        const gr = el('tr', { class: 'grp-row' });
        gr.appendChild(el('td', { colspan: colCount, text: '▸ ' + bucket.name + '　' + bucket.rows.length + ' 镜' }));
        tbody.appendChild(gr);
      }
      bucket.rows.forEach(s => {
        const tr = el('tr');
        tr.setAttribute('data-shot-id', s.id);
        if (selIds.indexOf(s.id) >= 0) tr.classList.add('sel');
        const tdi = el('td', { class: 'c-idx', title: '点击选中该镜头' });
        tdi.appendChild(el('div', { text: '#' + U.pad(idxMap[s.id] || 0) }));
        tdi.appendChild(el('div', { style: 'color:var(--txt2)', text: U.tc(s.in) }));
        tdi.addEventListener('click', () => LP.state.select([s.id], null));
        tr.appendChild(tdi);
        LP.FIELDS.forEach(f => tr.appendChild(cellFor(f, s)));
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    frag.appendChild(table);
    if (!rows.length) frag.appendChild(emptyBox('没有符合条件的镜头', '试试清空搜索或筛选'));
    elBody.appendChild(frag);
  }

  /* ------------------------------------------------------ R-017 看板视图 */
  function renderKanban(rows) {
    const f = LP.FIELD_MAP.size;
    const idxMap = shotIndexMap();
    const selIds = LP.state.selection.shotIds || [];
    const board = el('div', { class: 'kanban' });
    const cols = (f.options || []).map(o => ({ key: o, name: o, color: f.colors[o] }));
    cols.push({ key: '', name: '未填写', color: null });

    const frag = document.createDocumentFragment();
    cols.forEach(col => {
      const list = rows.filter(s => (s.size || '') === col.key);
      const c = el('div', { class: 'kb-col' });
      const hd = el('div', { class: 'kb-hd' });
      const t = el('span');
      if (col.color) t.appendChild(chipEl(f, col.name)); else t.appendChild(el('span', { style: 'color:var(--txt2)', text: col.name }));
      hd.appendChild(t);
      hd.appendChild(el('span', { style: 'color:var(--txt3);font-family:var(--mono);font-size:11px', text: list.length + '' }));
      c.appendChild(hd);
      const body = el('div', { class: 'kb-list' });
      list.forEach(s => {
        const card = el('div', { class: 'kb-card' });
        card.setAttribute('data-shot-id', s.id);
        if (selIds.indexOf(s.id) >= 0) card.classList.add('sel');
        card.appendChild(el('div', { class: 'kc-tc', text: '#' + U.pad(idxMap[s.id] || 0) + '　' + U.tc(s.in) + ' · ' + U.dur(durOf(s)) }));
        const mv = (s.move || []);
        const mvRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin:4px 0' });
        if (mv.length) mv.forEach(v => mvRow.appendChild(chipEl(LP.FIELD_MAP.move, v)));
        else mvRow.appendChild(el('span', { style: 'color:var(--txt3)', text: '运镜未填' }));
        card.appendChild(mvRow);
        const q7 = (s.sevenQ || '').trim();
        card.appendChild(el('div', {
          style: 'color:' + (q7 ? 'var(--txt2)' : 'var(--txt3)') + ';line-height:1.55',
          text: q7 ? (q7.length > 46 ? q7.slice(0, 46) + '…' : q7) : '七问未写'
        }));
        card.addEventListener('click', () => LP.state.select([s.id], null));
        body.appendChild(card);
      });
      c.appendChild(body);
      frag.appendChild(c);
    });
    board.appendChild(frag);
    elBody.appendChild(board);
    if (!rows.length) elBody.appendChild(emptyBox('没有符合条件的镜头'));
  }

  /* ------------------------------------------------------ R-017 画廊视图 */
  function aspectCSS() {
    const p = LP.state.project;
    if (p.videoRatio === '9:16') return '9/16';
    if (p.videoRatio === '16:9') return '16/9';
    const r = p.videoRef;
    if (r && r.w && r.h) return r.w + '/' + r.h;         // other：按素材实际比例，不拉伸
    return '16/9';
  }

  function renderGallery(rows) {
    const ar = aspectCSS();
    const idxMap = shotIndexMap();
    const selIds = LP.state.selection.shotIds || [];
    const wrap = el('div', { class: 'gallery' });
    const frag = document.createDocumentFragment();
    rows.forEach(s => {
      const card = el('div', { class: 'gal-card' });
      card.setAttribute('data-shot-id', s.id);
      if (selIds.indexOf(s.id) >= 0) card.classList.add('sel');
      const th = el('div', { class: 'gal-thumb', style: 'aspect-ratio:' + ar });
      if (s.thumb) th.appendChild(el('img', { src: s.thumb, alt: '关键帧' }));   // object-fit:contain 由 CSS 保证不拉伸
      else th.appendChild(el('span', { text: '未抓帧' }));
      card.appendChild(th);
      const meta = el('div', { class: 'gal-meta' });
      meta.appendChild(el('div', {
        style: 'font-family:var(--mono);font-size:10.5px;color:var(--txt3)',
        text: '#' + U.pad(idxMap[s.id] || 0) + '　' + U.tc(s.in) + ' · ' + U.dur(durOf(s))
      }));
      const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-top:4px' });
      if (s.size) row.appendChild(chipEl(LP.FIELD_MAP.size, s.size));
      if (s.soundRel) row.appendChild(chipEl(LP.FIELD_MAP.soundRel, s.soundRel));
      if (!s.size && !s.soundRel) row.appendChild(el('span', { style: 'color:var(--txt3)', text: '未标注' }));
      meta.appendChild(row);
      card.appendChild(meta);
      card.addEventListener('click', () => LP.state.select([s.id], null));
      frag.appendChild(card);
    });
    wrap.appendChild(frag);
    elBody.appendChild(wrap);
    if (!rows.length) elBody.appendChild(emptyBox('没有符合条件的镜头'));
  }

  /* ------------------------------------------------------ R-017 表单视图 */
  function formFieldNode(f, s) {
    const box = el('div', { class: 'field', style: 'margin-bottom:14px' });
    const lb = el('div', { class: 'field-lb' });
    lb.appendChild(el('span', { text: f.name }));
    lb.appendChild(el('span', { class: 'ftype', text: TYPE_CN[f.type] || f.type }));
    try { if (window.LP.help && LP.help.attachHint) LP.help.attachHint(lb, f); } catch (e) { }
    box.appendChild(lb);

    if (f.type === 'text' || f.type === 'longtext') {
      const inp = f.type === 'text'
        ? el('input', { type: 'text', spellcheck: 'false' })
        : el('textarea', { rows: '3', spellcheck: 'false' });
      inp.value = s[f.key] || '';
      inp.addEventListener('change', () => setValue(s.id, f.key, inp.value, '编辑' + f.name));
      box.appendChild(inp);
      if (f.write) box.appendChild(el('div', { style: 'color:var(--txt3);font-size:11px;margin-top:4px', text: f.write }));
    } else if (f.type === 'select' || f.type === 'multi') {
      const opts = el('div', { class: 'opts' });
      (f.options || []).forEach(o => {
        const b = el('button', { class: 'opt', type: 'button', text: o });
        const on = f.type === 'multi' ? (s[f.key] || []).indexOf(o) >= 0 : s[f.key] === o;
        const col = f.colors && f.colors[o];
        if (on) { b.classList.add('on'); if (col) { b.style.background = col; b.style.color = fgOf(col); } }
        b.addEventListener('click', () => {
          if (f.type === 'multi') toggleMulti(s.id, f.key, o);
          else setValue(s.id, f.key, s[f.key] === o ? '' : o, '编辑' + f.name);
          render();
        });
        opts.appendChild(b);
      });
      box.appendChild(opts);
    } else if (f.type === 'attachment') {
      if (s.thumb) box.appendChild(el('img', {
        src: s.thumb, alt: '关键帧',
        style: 'max-width:260px;width:100%;border-radius:5px;background:#000;display:block'
      }));
      else box.appendChild(el('div', { style: 'color:var(--txt3)', text: '未抓帧（在拉片台点「抓帧」）' }));
    } else if (f.type === 'relation') {
      const sel = el('select');
      sel.appendChild(optionEl('（未分组）', ''));
      LP.state.project.groups.forEach(g => sel.appendChild(optionEl(g.name, g.id)));
      sel.value = s.groupId || '';
      sel.addEventListener('change', () => { setValue(s.id, 'groupId', sel.value || null, '编辑所属段落组'); render(); });
      box.appendChild(sel);
    } else if (f.type === 'formula') {
      box.appendChild(el('div', {
        style: 'font-family:var(--mono);color:var(--txt2)',
        text: U.dur(durOf(s)) + '　（out − in，自动计算）'
      }));
    }
    return box;
  }

  function renderForm(rows) {
    if (!rows.length) { elBody.appendChild(emptyBox('没有符合条件的镜头')); return; }
    formIdx = U.clamp(formIdx, 0, rows.length - 1);
    const s = rows[formIdx];
    const idxMap = shotIndexMap();
    const wrap = el('div', { class: 'form-view' });

    const nav = el('div', { class: 'form-nav' });
    const prev = el('button', { class: 'btn sm', type: 'button', text: '◀ 上一条' });
    const next = el('button', { class: 'btn sm', type: 'button', text: '下一条 ▶' });
    prev.disabled = formIdx <= 0;
    next.disabled = formIdx >= rows.length - 1;
    prev.addEventListener('click', () => { formIdx--; const t = rows[formIdx]; if (t) LP.state.select([t.id], null); render(); });
    next.addEventListener('click', () => { formIdx++; const t = rows[formIdx]; if (t) LP.state.select([t.id], null); render(); });
    nav.appendChild(prev);
    nav.appendChild(el('div', {
      style: 'color:var(--txt2);font-size:12.5px',
      text: '第 ' + (formIdx + 1) + ' / ' + rows.length + ' 条　·　镜头 #' + U.pad(idxMap[s.id] || 0) + ' ' + U.tc(s.in)
    }));
    nav.appendChild(next);
    wrap.appendChild(nav);

    const prog = el('div', { class: 'prog', style: 'margin:0 0 12px' });
    const bar = el('i'); bar.style.width = ((formIdx + 1) / rows.length * 100).toFixed(1) + '%';
    prog.appendChild(bar);
    wrap.appendChild(prog);

    const card = el('div', { class: 'form-card' });
    const frag = document.createDocumentFragment();
    LP.FIELDS.forEach(f => frag.appendChild(formFieldNode(f, s)));
    card.appendChild(frag);
    wrap.appendChild(card);
    elBody.appendChild(wrap);
  }

  /* ------------------------------------------------- R-018 工具条（一次建） */
  let tKw = null, tField = null, tVal = null, tGrp = null, tSort = null, tDir = null, tOnly = null, tCount = null;

  function fillFilterValues() {
    if (!tVal) return;
    const keep = q.fval;
    tVal.textContent = '';
    tVal.appendChild(optionEl('全部值', ''));
    const f = LP.FIELD_MAP[q.fkey];
    if (f) {
      if (f.type === 'relation') {
        LP.state.project.groups.forEach(g => tVal.appendChild(optionEl(g.name, g.id)));
        tVal.appendChild(optionEl('（未分组）', '__none'));
      } else {
        (f.options || []).forEach(o => tVal.appendChild(optionEl(o, o)));
        tVal.appendChild(optionEl('（未填写）', '__empty'));
      }
    }
    tVal.value = keep;
    if (tVal.value !== keep) { q.fval = ''; tVal.value = ''; }
    tVal.disabled = !q.fkey;
  }

  function buildTools() {
    elTools.textContent = '';

    tKw = el('input', { type: 'text', class: 'mini-input', placeholder: '搜索所有文本字段…', title: 'R-018 关键词搜索', style: 'width:150px' });
    tKw.value = q.kw;
    tKw.addEventListener('input', () => { q.kw = tKw.value; render(); });
    elTools.appendChild(tKw);

    tField = el('select', { class: 'mini-input', title: '按字段筛选（例：只看特写）' });
    tField.appendChild(optionEl('筛选字段', ''));
    LP.FIELDS.filter(f => ['select', 'multi', 'relation'].indexOf(f.type) >= 0)
      .forEach(f => tField.appendChild(optionEl(f.name, f.key)));
    tField.addEventListener('change', () => { q.fkey = tField.value; q.fval = ''; fillFilterValues(); render(); });
    elTools.appendChild(tField);

    tVal = el('select', { class: 'mini-input', title: '筛选值' });
    tVal.addEventListener('change', () => { q.fval = tVal.value; render(); });
    elTools.appendChild(tVal);
    fillFilterValues();

    elTools.appendChild(el('span', { class: 'sep' }));

    tGrp = el('select', { class: 'mini-input', title: '分组' });
    [['none', '不分组'], ['size', '按景别分组'], ['soundRel', '按声画关系分组'], ['cutType', '按切换方式分组'], ['groupId', '按段落组分组']]
      .forEach(p => tGrp.appendChild(optionEl(p[1], p[0])));
    tGrp.value = q.grp;
    tGrp.addEventListener('change', () => { q.grp = tGrp.value; render(); });
    elTools.appendChild(tGrp);

    tSort = el('select', { class: 'mini-input', title: '排序' });
    [['in', '按入点排序'], ['duration', '按时长排序'], ['size', '按景别排序']]
      .forEach(p => tSort.appendChild(optionEl(p[1], p[0])));
    tSort.value = q.sortKey;
    tSort.addEventListener('change', () => { q.sortKey = tSort.value; render(); });
    elTools.appendChild(tSort);

    tDir = el('button', { class: 'btn xs', type: 'button', title: '升序 / 降序切换', text: '↑ 升' });
    tDir.addEventListener('click', () => { q.sortAsc = !q.sortAsc; render(); });
    elTools.appendChild(tDir);

    elTools.appendChild(el('span', { class: 'sep' }));

    tOnly = el('button', { class: 'btn xs', type: 'button', title: '只显示当前选中段落组内的镜头', text: '仅当前段落组' });
    tOnly.addEventListener('click', () => {
      if (!q.onlyGroup && !curGroupId()) { U.toast('先在时间线或表格里选中一个段落组'); return; }
      q.onlyGroup = !q.onlyGroup; render();
    });
    elTools.appendChild(tOnly);

    const tReset = el('button', { class: 'btn xs ghost', type: 'button', title: '清空搜索/筛选/分组/排序', text: '重置' });
    tReset.addEventListener('click', () => {
      q.kw = ''; q.fkey = ''; q.fval = ''; q.grp = 'none'; q.sortKey = 'in'; q.sortAsc = true; q.onlyGroup = false;
      tKw.value = ''; tField.value = ''; tGrp.value = 'none'; tSort.value = 'in';
      fillFilterValues(); render();
    });
    elTools.appendChild(tReset);

    tCount = el('span', { style: 'color:var(--txt3);font-size:11.5px;font-family:var(--mono)' });
    elTools.appendChild(tCount);
  }

  function syncTools(n) {
    if (!tCount) return;
    if (LP.FIELD_MAP[q.fkey] && LP.FIELD_MAP[q.fkey].type === 'relation') fillFilterValues();
    tDir.textContent = q.sortAsc ? '↑ 升' : '↓ 降';
    tOnly.classList.toggle('on', q.onlyGroup);
    const total = LP.state.project.shots.length;
    tCount.textContent = n === total ? (total + ' 镜') : (n + ' / ' + total + ' 镜');
  }

  /* ------------------------------------------------------------- 渲染入口 */
  function markSel() {
    const ids = LP.state.selection.shotIds || [];
    U.$$('[data-shot-id]', elBody).forEach(n => n.classList.toggle('sel', ids.indexOf(n.getAttribute('data-shot-id')) >= 0));
  }

  function syncFormIdx(rows) {
    const cur = LP.state.current();
    if (!cur) return;
    const i = rows.findIndex(s => s.id === cur.id);
    if (i >= 0) formIdx = i;
  }

  function render() {
    if (!inited) return;
    closePop();
    const top = elBody.scrollTop, left = elBody.scrollLeft;
    elBody.textContent = '';
    const rows = currentRows();
    syncTools(rows.length);
    if (!LP.state.project.shots.length) {
      elBody.appendChild(emptyBox('还没有镜头', '回到「拉片台」导入视频并切分片段，这里会自动逐行生成（R-014）'));
      return;
    }
    if (view === 'grid') renderGrid(rows);
    else if (view === 'kanban') renderKanban(rows);
    else if (view === 'gallery') renderGallery(rows);
    else renderForm(rows);
    elBody.scrollTop = top; elBody.scrollLeft = left;
  }

  function setView(v) {
    if (['grid', 'kanban', 'gallery', 'form'].indexOf(v) < 0) return;
    view = v;
    if (elTabs) U.$$('.vtab', elTabs).forEach(b => b.classList.toggle('on', b.getAttribute('data-view') === v));
    if (view === 'form') syncFormIdx(currentRows());
    render();
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    if (inited) return;
    elPage = document.getElementById('page-table');
    elTabs = document.getElementById('viewTabs');
    elTools = document.getElementById('tblTools');
    elBody = document.getElementById('tblBody');
    if (!elPage || !elTabs || !elTools || !elBody) { console.warn('[LP.table] 挂载点缺失，模块未启动'); return; }
    inited = true;

    U.$$('.vtab', elTabs).forEach(b => b.addEventListener('click', () => setView(b.getAttribute('data-view'))));
    buildTools();

    LP.bus.on('change', () => { if (!selfCommit && visible()) render(); });
    LP.bus.on('selection', () => {
      if (!visible()) return;
      if (view === 'form') { const rows = currentRows(); syncFormIdx(rows); render(); }
      else markSel();
    });
    LP.bus.on('project:loaded', () => { formIdx = 0; if (visible()) render(); });
    LP.bus.on('page', p => { if (p === 'table') render(); else closePop(); });
    window.addEventListener('resize', closePop);

    if (visible()) render();
  }

  return { init, render, setView, currentRows, get view() { return view; } };
})();
