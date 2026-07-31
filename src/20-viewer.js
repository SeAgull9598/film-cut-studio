/* =========================================================================
 * 20 viewer — 检视器 / 走带控制 / 虚拟片段播放
 * R-009 点色块即播：seek 到 in、播到 out 自动停，可暂停/拖动/循环
 * R-010 时间线按秒映射，横竖屏共用（检视器 letterbox 由 CSS max-width/height 完成）
 * 快捷键行为：Space / J K L / ←→ / Shift+←→ / I O / Shift+I O
 * ========================================================================= */
LP.player = (function () {
  const U = LP.util;
  let v = null;
  let range = null;          // 当前虚拟片段播放区间 {in,out,shotId}
  let queue = null;          // 段落组连播队列 {list:[{in,out}], idx}
  let loop = false;
  let jklRate = 0;           // 0=停, 正=正放档, 负=倒放档
  let revRaf = null, revLast = 0;
  let inPt = null, outPt = null;

  const fps = () => LP.state.project.meta.fps || 25;
  const dur = () => (v && isFinite(v.duration) ? v.duration : (LP.state.project.videoRef?.duration || 0));

  /* ------------------------------------------------------- 基础控制 */
  function seek(t, opts) {
    if (!v || !v.src) return;
    v.currentTime = U.clamp(t, 0, Math.max(0, dur() - 0.001));
    if (!(opts && opts.keepRange)) { /* 手动拖动允许跑出区间：只解除自动停，不清 range 显示 */ }
    tick();
  }
  function time() { return v ? v.currentTime : 0; }
  function play() { if (v && v.src) { stopReverse(); v.play().catch(() => { }); } }
  function pause() { if (v) v.pause(); stopReverse(); }
  function toggle() { if (!v || !v.src) return U.toast('请先导入视频'); (v.paused ? play() : pause()); }

  /* R-009 播放某个虚拟片段：seek 到 in，播到 out 自动停 */
  function playRange(inSec, outSec, opts) {
    if (!v || !v.src) return U.toast('请先导入视频');
    opts = opts || {};
    queue = null;
    range = { in: inSec, out: outSec, shotId: opts.shotId || null };
    U.$('#playingBadge').hidden = false;
    v.currentTime = inSec;
    if (opts.noPlay) { pause(); }
    else play();
    updateBadge();
  }
  /** 段落组虚拟连播：依次 seek 各成员 in/out，不重编码（R-012） */
  function playQueue(list, opts) {
    if (!v || !v.src) return U.toast('请先导入视频');
    if (!list || !list.length) return;
    queue = { list: list.slice(), idx: 0, label: (opts && opts.label) || '段落组' };
    range = null;
    U.$('#playingBadge').hidden = false;
    v.currentTime = queue.list[0].in;
    play(); updateBadge();
  }
  function clearRange() {
    range = null; queue = null;
    const b = U.$('#playingBadge'); if (b) b.hidden = true;
  }
  function updateBadge() {
    const b = U.$('#playingBadge'); if (!b) return;
    if (queue) b.textContent = '段落组连播 ' + (queue.idx + 1) + '/' + queue.list.length + (loop ? ' · 循环' : '');
    else if (range) b.textContent = '片段播放' + (loop ? ' · 循环' : '');
  }

  /* --------------------------------------------------- JKL 走带 */
  function jkl(dir) {
    if (!v || !v.src) return;
    const steps = [1, 2, 4, 8, 16];
    if (dir === 0) { jklRate = 0; pause(); v.playbackRate = 1; renderRate(); return; }
    if (dir > 0) {
      jklRate = jklRate >= 1 ? Math.min(jklRate + 1, steps.length) : 1;
      stopReverse();
      v.playbackRate = steps[jklRate - 1];
      v.play().catch(() => { });
    } else {
      jklRate = jklRate <= -1 ? Math.max(jklRate - 1, -steps.length) : -1;
      v.pause(); v.playbackRate = 1;
      startReverse(steps[-jklRate - 1]);
    }
    renderRate();
  }
  function renderRate() {
    const el = U.$('#rateTag'); if (!el) return;
    const steps = [1, 2, 4, 8, 16];
    el.textContent = jklRate === 0 ? '' : (jklRate > 0 ? steps[jklRate - 1] + '×' : '-' + steps[-jklRate - 1] + '×');
  }
  function startReverse(rate) {
    stopReverse(); revLast = performance.now();
    const step = (now) => {
      const dt = (now - revLast) / 1000; revLast = now;
      v.currentTime = Math.max(0, v.currentTime - dt * rate);
      if (v.currentTime <= 0.001) { jklRate = 0; renderRate(); stopReverse(); return; }
      tick(); revRaf = requestAnimationFrame(step);
    };
    revRaf = requestAnimationFrame(step);
  }
  function stopReverse() { if (revRaf) { cancelAnimationFrame(revRaf); revRaf = null; } }

  function stepFrame(n) {
    if (!v || !v.src) return;
    pause(); jklRate = 0; renderRate();
    v.currentTime = U.clamp(v.currentTime + n / fps(), 0, Math.max(0, dur() - 1 / fps()));
  }
  /** 跳到上/下一个剪辑点（所有片段的 in/out 边界） */
  function jumpCut(dir) {
    const pts = cutPoints();
    if (!pts.length) return;
    const t = time() + dir * 0.001;
    let target = null;
    if (dir > 0) { for (const p of pts) if (p > t + 0.02) { target = p; break; } }
    else { for (let i = pts.length - 1; i >= 0; i--) if (pts[i] < t - 0.02) { target = pts[i]; break; } }
    if (target == null) return U.toast(dir > 0 ? '已是最后一个剪辑点' : '已是第一个剪辑点');
    seek(target);
    const hit = LP.state.shots().find(s => Math.abs(s.in - target) < 0.005);
    if (hit) LP.state.select([hit.id], null, { fromPlayer: true });
  }
  function cutPoints() {
    const set = new Set([0]);
    LP.state.shots().forEach(s => { set.add(+s.in.toFixed(3)); set.add(+s.out.toFixed(3)); });
    return Array.from(set).sort((a, b) => a - b);
  }

  /* ------------------------------------------------------ 入出点 */
  function setIn(t) {
    inPt = t == null ? time() : t;
    if (outPt != null && outPt <= inPt) outPt = null;
    renderIO();
  }
  function setOut(t) {
    outPt = t == null ? time() : t;
    if (inPt != null && inPt >= outPt) inPt = null;
    renderIO();
  }
  function clearIO() { inPt = outPt = null; renderIO(); }
  function getIO() { return { in: inPt, out: outPt }; }
  function renderIO() {
    const el = U.$('#ioVal');
    if (el) el.textContent = (inPt == null ? '—' : U.tc(inPt)) + ' / ' + (outPt == null ? '—' : U.tc(outPt));
    LP.bus.emit('io', { in: inPt, out: outPt });
  }

  /* -------------------------------------------------------- tick */
  function tick() {
    if (!v) return;
    const t = v.currentTime;
    const now = U.$('#tcNow'); if (now) now.textContent = U.tc(t);
    LP.bus.emit('time', { t: t, playing: !v.paused });
  }

  function onTimeUpdate() {
    if (!v) return;
    const t = v.currentTime;
    /* R-009 播到 out 自动停 */
    if (range && t >= range.out - 0.012) {
      if (loop) { v.currentTime = range.in; }
      else { v.pause(); v.currentTime = Math.max(range.in, range.out - 1 / fps()); clearRangeBadgeSoon(); }
    }
    /* R-012 组连播：到本段 out 跳下一段 in */
    if (queue) {
      const cur = queue.list[queue.idx];
      if (cur && t >= cur.out - 0.012) {
        if (queue.idx < queue.list.length - 1) { queue.idx++; v.currentTime = queue.list[queue.idx].in; updateBadge(); }
        else if (loop) { queue.idx = 0; v.currentTime = queue.list[0].in; updateBadge(); }
        else { v.pause(); clearRangeBadgeSoon(); }
      }
    }
    tick();
  }
  let badgeTimer = null;
  function clearRangeBadgeSoon() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => { const b = U.$('#playingBadge'); if (b && v.paused) b.hidden = true; }, 900);
  }

  /* -------------------------------------------------------- init */
  function init() {
    v = U.$('#video');
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('play', () => { U.$('#btnPlay').textContent = '❚❚'; tick(); rafLoop(); });
    v.addEventListener('pause', () => { U.$('#btnPlay').textContent = '▶'; jklRate = 0; v.playbackRate = 1; renderRate(); tick(); });
    v.addEventListener('loadedmetadata', () => {
      U.$('#tcDur').textContent = '/ ' + U.tc(v.duration);
      U.$('#viewerInfo').textContent = LP.state.project.videoRef ? LP.state.project.videoRef.name : '';
      clearIO(); tick();
    });
    v.addEventListener('click', () => toggle());

    U.$('#btnPlay').onclick = toggle;
    U.$('#btnStepB').onclick = () => stepFrame(-1);
    U.$('#btnStepF').onclick = () => stepFrame(1);
    U.$('#btnJ').onclick = () => jkl(-1);
    U.$('#btnL').onclick = () => jkl(1);
    U.$('#btnPrevCut').onclick = () => jumpCut(-1);
    U.$('#btnNextCut').onclick = () => jumpCut(1);
    U.$('#btnIn').onclick = () => setIn();
    U.$('#btnOut').onclick = () => setOut();
    U.$('#loopChk').onchange = e => { loop = e.target.checked; updateBadge(); };
    U.$('#btnAddShot').onclick = () => LP.edit.addShotFromIO();

    /* 拖动进度：点击时间线由 timeline 处理，这里处理键盘微调后的 UI 同步 */
    LP.bus.on('project:loaded', () => { clearRange(); clearIO(); });
    renderIO(); renderRate();
  }
  /* 播放时用 rAF 提高时间码刷新率（timeupdate 只有 ~4Hz） */
  function rafLoop() {
    if (!v || v.paused) return;
    tick();
    requestAnimationFrame(rafLoop);
  }

  return {
    init, seek, time, play, pause, toggle, playRange, playQueue, clearRange,
    jkl, stepFrame, jumpCut, setIn, setOut, clearIO, getIO, cutPoints,
    get loop() { return loop; },
    set loop(x) { loop = x; const c = U.$('#loopChk'); if (c) c.checked = x; updateBadge(); },
    get range() { return range; },
    duration: dur
  };
})();
