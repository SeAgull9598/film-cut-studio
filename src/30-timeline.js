/* =========================================================================
 * 30 timeline — 时间线（按秒映射，虚拟片段）
 * R-008 虚拟片段：只存 in/out 引用源视频，不重编码
 * R-009 点色块即播
 * R-010 按时间(秒)映射，横竖屏共用同一轴（与分辨率无关）
 * ========================================================================= */
LP.timeline = (function () {
  const U = LP.util;
  let pps = 60;             // px per second
  let tool = 'arrow';       // arrow | blade
  let dragging = null;
  let scrollEl, innerEl, rulerEl, shotsEl, groupsEl, headEl, ioEl, snapEl;

  const duration = () => (LP.state.project.videoRef?.duration) || 60;
  const x2t = (x) => x / pps;
  const t2x = (t) => t * pps;

  function indexOf(shotId) {
    const list = LP.state.shots();
    const i = list.findIndex(s => s.id === shotId);
    return i < 0 ? '-' : (i + 1);
  }

  /* ------------------------------------------------------------ 渲染 */
  function render() {
    if (!innerEl) return;
    const dur = duration();
    const W = Math.max(scrollEl.clientWidth, Math.ceil(t2x(dur)) + 40);
    innerEl.style.width = W + 'px';
    renderRuler(dur, W);
    renderGroups();
    renderShots();
    renderPlayhead(LP.player.time());
    renderIO(LP.player.getIO());
    const info = U.$('#tlInfo');
    if (info) info.textContent = LP.state.project.shots.length + ' 片段 · ' + LP.state.project.groups.length + ' 组';
    const pc = U.$('#poolCount');
    if (pc) pc.textContent = LP.state.project.shots.length + ' 镜';
  }

  function renderRuler(dur, W) {
    /* 自适应刻度：目标 ~80px 一格 */
    const raw = 80 / pps;
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s >= raw) || 600;
    let html = '';
    for (let t = 0; t <= dur; t += step) {
      const major = Math.abs((t / step) % 5) < 1e-6;
      html += '<div class="tick' + (major ? ' major' : '') + '" style="left:' + t2x(t).toFixed(1) + 'px">' +
        (major || step >= 1 ? fmtTick(t, step) : '') + '</div>';
    }
    rulerEl.innerHTML = html;
    rulerEl.style.width = W + 'px';
  }
  function fmtTick(t, step) {
    if (step < 1) return t.toFixed(1) + 's';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + U.pad(s);
  }

  function renderShots() {
    const frag = document.createDocumentFragment();
    const sel = LP.state.selection.shotIds;
    const shots = LP.state.shots();
    shots.forEach((s, i) => {
      const w = Math.max(2, t2x(s.out - s.in));
      const d = U.el('div', {
        class: 'tl-clip' + (sel.indexOf(s.id) >= 0 ? ' sel' : ''),
        style: 'left:' + t2x(s.in).toFixed(1) + 'px;width:' + w.toFixed(1) + 'px',
        'data-id': s.id, title: '#' + (i + 1) + '  ' + U.tc(s.in) + ' → ' + U.tc(s.out) + '  (' + U.dur(s.out - s.in) + ')\n点击播放该片段'
      });
      const sizeColor = (LP.FIELD_MAP.size.colors || {})[s.size] || null;
      let body = '';
      if (w > 46) {
        const tags = [];
        if (s.size) tags.push(s.size);
        if (s.move && s.move.length) tags.push(s.move.join('·'));
        body = '<div class="c-body">' + U.esc(tags.join(' / ')) + '</div>';
      }
      d.innerHTML = '<div class="c-hd">' + (i + 1) + (w > 70 ? ' · ' + U.dur(s.out - s.in) : '') + '</div>' + body +
        (sizeColor ? '<div class="c-bar" style="background:' + sizeColor + '"></div>' : '');
      if (s.thumb && w > 90) d.style.backgroundImage = 'linear-gradient(rgba(20,30,45,.72),rgba(20,30,45,.86)),url(' + s.thumb + ')',
        d.style.backgroundSize = 'cover', d.style.backgroundPosition = 'center';
      d.appendChild(U.el('div', { class: 'c-hdl l', 'data-edge': 'in' }));
      d.appendChild(U.el('div', { class: 'c-hdl r', 'data-edge': 'out' }));
      frag.appendChild(d);
    });
    shotsEl.innerHTML = ''; shotsEl.appendChild(frag);
  }

  function renderGroups() {
    const frag = document.createDocumentFragment();
    LP.state.project.groups.forEach(g => {
      const ms = LP.state.groupShots(g.id);
      if (!ms.length) return;
      const a = Math.min.apply(null, ms.map(s => s.in));
      const b = Math.max.apply(null, ms.map(s => s.out));
      const d = U.el('div', {
        class: 'tl-grp' + (LP.state.selection.groupId === g.id ? ' sel' : ''),
        style: 'left:' + t2x(a).toFixed(1) + 'px;width:' + Math.max(8, t2x(b - a)).toFixed(1) + 'px',
        'data-gid': g.id,
        title: '段落组：' + g.name + '（' + ms.length + ' 镜）\n点击 = 虚拟顺序连播'
      });
      d.textContent = '▣ ' + g.name + ' (' + ms.length + ')';
      frag.appendChild(d);
    });
    groupsEl.innerHTML = ''; groupsEl.appendChild(frag);
  }

  function renderPlayhead(t) {
    if (!headEl) return;
    headEl.style.left = t2x(t).toFixed(1) + 'px';
  }
  function renderIO(io) {
    if (!ioEl) return;
    if (io.in == null && io.out == null) { ioEl.hidden = true; return; }
    const a = io.in == null ? 0 : io.in, b = io.out == null ? duration() : io.out;
    ioEl.hidden = false;
    ioEl.style.left = t2x(a).toFixed(1) + 'px';
    ioEl.style.width = Math.max(2, t2x(b - a)).toFixed(1) + 'px';
  }
  function scrollToTime(t) {
    const x = t2x(t);
    if (x < scrollEl.scrollLeft + 30 || x > scrollEl.scrollLeft + scrollEl.clientWidth - 30)
      scrollEl.scrollLeft = Math.max(0, x - scrollEl.clientWidth * 0.35);
  }

  /* 吸附：拖动片段边界时，吸到相邻镜头边缘 / 播放头 / 端点，避免留缝或重叠 */
  const SNAP_PX = 7;
  function snapPoints(excludeId) {
    const t = [0, duration()];
    LP.state.shots().forEach(s => { if (s.id !== excludeId) { t.push(s.in, s.out); } });
    const ph = LP.player.time(); if (isFinite(ph) && ph > 0) t.push(ph);
    return t;
  }
  function snapTime(t, excludeId) {
    const th = SNAP_PX / pps;
    let best = t, d0 = th;
    snapPoints(excludeId).forEach(p => { const d = Math.abs(p - t); if (d <= d0) { d0 = d; best = p; } });
    return { t: best, on: best !== t };
  }
  function showSnap(t) { if (snapEl) { snapEl.style.left = t2x(t).toFixed(1) + 'px'; snapEl.hidden = false; } }
  function hideSnap() { if (snapEl) snapEl.hidden = true; }

  /* ------------------------------------------------------- 交互 */
  function onShotsClick(e) {
    const clip = e.target.closest('.tl-clip');
    if (!clip) return;
    const s = LP.state.shot(clip.dataset.id); if (!s) return;

    /* 刀片工具：点哪切哪 */
    if (tool === 'blade') {
      const t = x2t(e.offsetX + clip.offsetLeft);
      LP.edit.splitAt(s, t);
      return;
    }
    if (e.shiftKey) {
      const cur = LP.state.selection.shotIds.slice();
      const i = cur.indexOf(s.id);
      if (i >= 0) cur.splice(i, 1); else cur.push(s.id);
      LP.state.select(cur, null);
      return;
    }
    LP.state.select([s.id], null);
    LP.player.playRange(s.in, s.out, { shotId: s.id });   /* R-009 */
  }

  function onGroupsClick(e) {
    const g = e.target.closest('.tl-grp'); if (!g) return;
    const grp = LP.state.group(g.dataset.gid); if (!grp) return;
    const ms = LP.state.groupShots(grp.id);
    LP.state.select(ms.map(s => s.id), grp.id);
    LP.player.playQueue(ms.map(s => ({ in: s.in, out: s.out })), { label: grp.name });  /* R-012 */
  }

  /* 点击标尺/空白 = 移动播放头 */
  function onScrub(e) {
    if (e.target.closest('.tl-clip') || e.target.closest('.tl-grp')) return;
    const rect = innerEl.getBoundingClientRect();
    const t = U.clamp(x2t(e.clientX - rect.left), 0, duration());
    LP.player.clearRange();
    LP.player.seek(t);
    const move = ev => {
      const tt = U.clamp(x2t(ev.clientX - rect.left), 0, duration());
      LP.player.seek(tt);
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  /* 拖拽片段边缘改 in/out（非破坏性，只改时间码） */
  function onHandleDown(e) {
    const hdl = e.target.closest('.c-hdl'); if (!hdl) return;
    e.stopPropagation(); e.preventDefault();
    const clip = hdl.closest('.tl-clip');
    const s = LP.state.shot(clip.dataset.id); if (!s) return;
    const edge = hdl.dataset.edge;
    const rect = innerEl.getBoundingClientRect();
    LP.state.push();
    dragging = true;
    const move = ev => {
      const raw = U.clamp(x2t(ev.clientX - rect.left), 0, duration());
      const min = 1 / (LP.state.project.meta.fps || 25);
      const sn = snapTime(raw, s.id);
      const t = sn.t;
      if (edge === 'in') s.in = +U.clamp(t, 0, s.out - min).toFixed(3);
      else s.out = +U.clamp(t, s.in + min, duration()).toFixed(3);
      renderShots(); renderGroups();
      if (sn.on) showSnap(t); else hideSnap();
      const st = U.$('#statusBar');
      if (st) st.textContent = '调整边界 ' + U.tc(s.in) + ' → ' + U.tc(s.out) + (sn.on ? ' · 吸附' : '') + '  (' + U.dur(s.out - s.in) + ')';
    };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      hideSnap();
      dragging = false; LP.state.commit('调整片段边界');
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  function setTool(t) {
    tool = t;
    U.$('#toolArrow').classList.toggle('on', t === 'arrow');
    U.$('#toolBlade').classList.toggle('on', t === 'blade');
    scrollEl.classList.toggle('blade', t === 'blade');
  }
  function setZoom(z) {
    pps = U.clamp(z, 4, 800);
    const zi = U.$('#tlZoom'); if (zi && +zi.value !== pps) zi.value = pps;
    render();
  }

  /* -------------------------------------------------------- init */
  function init() {
    scrollEl = U.$('#tlScroll'); innerEl = U.$('#tlInner'); rulerEl = U.$('#tlRuler');
    shotsEl = U.$('#tlShots'); groupsEl = U.$('#tlGroups'); headEl = U.$('#tlPlayhead'); ioEl = U.$('#tlInOut');
    snapEl = U.el('div', { class: 'tl-snap' }); snapEl.hidden = true; innerEl.appendChild(snapEl);

    shotsEl.addEventListener('mousedown', onHandleDown);
    shotsEl.addEventListener('click', onShotsClick);
    groupsEl.addEventListener('click', onGroupsClick);
    rulerEl.addEventListener('mousedown', onScrub);
    innerEl.addEventListener('mousedown', e => { if (e.target === innerEl || e.target === shotsEl || e.target === groupsEl) onScrub(e); });

    /* 滚轮缩放（Cmd/Ctrl+滚轮）与横向滚动 */
    scrollEl.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = innerEl.getBoundingClientRect();
        const tAt = x2t(e.clientX - rect.left);
        setZoom(pps * (e.deltaY < 0 ? 1.18 : 0.85));
        scrollEl.scrollLeft = U.clamp(t2x(tAt) - (e.clientX - scrollEl.getBoundingClientRect().left), 0, 1e7);
      } else if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
        scrollEl.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    U.$('#tlZoom').oninput = e => setZoom(+e.target.value);
    U.$('#toolArrow').onclick = () => setTool('arrow');
    U.$('#toolBlade').onclick = () => setTool('blade');
    setTool('arrow');

    LP.bus.on('time', d => { renderPlayhead(d.t); if (d.playing) scrollToTime(d.t); });
    LP.bus.on('io', renderIO);
    LP.bus.on('change', () => { if (!dragging) render(); });
    LP.bus.on('selection', () => { if (!dragging) { renderShots(); renderGroups(); } });
    LP.bus.on('project:loaded', () => { fit(); });
    window.addEventListener('resize', () => render());
    render();
  }
  /** 适配整片宽度 */
  function fit() {
    const w = (scrollEl ? scrollEl.clientWidth : 800) - 30;
    setZoom(Math.max(4, w / Math.max(1, duration())));
  }

  return { init, render, indexOf, setZoom, setTool, fit, scrollToTime, get pps() { return pps; }, get tool() { return tool; } };
})();
