/* =========================================================================
 * 10 media — 视频导入 / 横竖屏判定 / 抓帧 / 缩略图
 * R-001 本地导入（点击+拖拽，ObjectURL，不上传）
 * R-002 videoWidth/Height 判定 16:9 / 9:16
 * R-025 大视频 Blob 存 IndexedDB，关页重开可恢复
 * ========================================================================= */
LP.media = (function () {
  const U = LP.util;
  let objectUrl = null;
  let video = null;
  let thumbCanvas = null;

  /* R-002 比例判定：≤0.85 竖屏，≥1.7 横屏，其余记原始比例 */
  function judgeRatio(w, h) {
    if (!w || !h) return 'other';
    const r = w / h;
    if (r <= 0.85) return '9:16';
    if (r >= 1.7) return '16:9';
    return 'other';
  }

  function applyRatioUI() {
    const p = LP.state.project;
    const tag = U.$('#ratioTag');
    if (!tag) return;
    const v = p.videoRef;
    if (!v) { tag.textContent = '—'; return; }
    const label = p.videoRatio === '16:9' ? '横屏 16:9' : p.videoRatio === '9:16' ? '竖屏 9:16' : (v.w + '×' + v.h);
    tag.textContent = label;
    document.body.dataset.ratio = p.videoRatio;
  }

  /** 载入一个 URL 到主播放器，返回元数据 */
  function attach(url) {
    return new Promise((resolve, reject) => {
      video = U.$('#video');
      if (objectUrl && objectUrl !== url) { try { URL.revokeObjectURL(objectUrl); } catch (e) { } }
      objectUrl = url;
      video.src = url;
      video.classList.add('on');
      const onMeta = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        U.$('#stageEmpty').hidden = true;
        resolve({ duration: video.duration, w: video.videoWidth, h: video.videoHeight });
      };
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', () => reject(new Error('浏览器无法解码该视频（尝试 mp4/H.264 或 webm）')), { once: true });
    });
  }

  /** R-001 导入本地文件：只走内存 ObjectURL，无任何上传 */
  async function importFile(file, opts) {
    if (!file || !/^video\//.test(file.type) && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
      return U.toast('请选择视频文件', 'err');
    }
    opts = opts || {};
    U.toast('正在载入 ' + file.name + '…');
    const url = URL.createObjectURL(file);
    let meta;
    try { meta = await attach(url); }
    catch (e) { return U.toast(e.message, 'err'); }

    const p = LP.state.project;
    const keepShots = opts.keepShots && p.videoRef && Math.abs((p.videoRef.duration || 0) - meta.duration) < 0.5;
    const idbKey = 'video_' + (file.name || 'v') + '_' + file.size;

    p.videoRef = { name: file.name, size: file.size, type: file.type, duration: meta.duration, w: meta.w, h: meta.h, idbKey };
    p.videoRatio = judgeRatio(meta.w, meta.h);
    if (!keepShots) { p.shots = []; p.groups = []; }
    if (p.meta.title === '未命名拉片工程') {
      p.meta.title = file.name.replace(/\.[^.]+$/, '');
      const t = U.$('#projTitle'); if (t) t.value = p.meta.title;
    }
    LP.state.commit('导入视频');
    LP.bus.emit('project:loaded', p);
    applyRatioUI();
    renderMediaCard();

    /* R-025 缓存到 IndexedDB，关页重开可恢复（失败只警告不阻断） */
    LP.storage.putBlob(idbKey, file).then(ok => {
      if (ok) U.toast('已载入并本地缓存 · 素材不出机', 'ok');
      else U.toast('已载入（本机缓存不可用，重开需重新选片）');
    });
    return true;
  }

  /** 页面重开时尝试从 IndexedDB 恢复视频 */
  async function tryRestore() {
    const p = LP.state.project;
    if (!p.videoRef || !p.videoRef.idbKey) return false;
    const blob = await LP.storage.getBlob(p.videoRef.idbKey);
    if (!blob) {
      setStatus('工程已恢复，但视频需重新选择：' + p.videoRef.name);
      renderMediaCard(true);
      return false;
    }
    try {
      await attach(URL.createObjectURL(blob));
      applyRatioUI(); renderMediaCard();
      U.toast('已从本机缓存恢复：' + p.videoRef.name, 'ok');
      LP.bus.emit('project:loaded', p);
      return true;
    } catch (e) { return false; }
  }

  function renderMediaCard(missing) {
    const box = U.$('#poolMedia'); if (!box) return;
    const v = LP.state.project.videoRef;
    if (!v) return;
    box.innerHTML = '';
    const card = U.el('div', { class: 'media-card' });
    card.innerHTML =
      '<div class="mc-name">' + U.esc(v.name) + (missing ? ' <span class="badge risk">需重选</span>' : '') + '</div>' +
      '<div class="mc-row"><span>' + U.dur(v.duration) + '</span><span>' + v.w + '×' + v.h + '</span></div>' +
      '<div class="mc-row"><span>' + (v.size / 1048576).toFixed(1) + ' MB</span><span>' +
      (LP.state.project.videoRatio === '9:16' ? '竖屏' : LP.state.project.videoRatio === '16:9' ? '横屏' : '自定义') + '</span></div>';
    const btn = U.el('button', { class: 'btn xs', text: missing ? '重新选择视频' : '更换视频', style: 'margin-top:6px;width:100%' });
    btn.onclick = () => { pendingKeep = !!missing; U.$('#fileInput').click(); };
    box.appendChild(card); box.appendChild(btn);
  }
  let pendingKeep = false;

  /** 抓当前帧 -> dataURL（按原比例，最长边 maxW） */
  function grabFrame(maxW) {
    const v = U.$('#video');
    if (!v || !v.videoWidth) return null;
    maxW = maxW || 320;
    if (!thumbCanvas) thumbCanvas = document.createElement('canvas');
    const scale = Math.min(1, maxW / Math.max(v.videoWidth, v.videoHeight));
    thumbCanvas.width = Math.round(v.videoWidth * scale);
    thumbCanvas.height = Math.round(v.videoHeight * scale);
    const ctx = thumbCanvas.getContext('2d');
    try { ctx.drawImage(v, 0, 0, thumbCanvas.width, thumbCanvas.height); }
    catch (e) { return null; }
    try { return thumbCanvas.toDataURL('image/jpeg', 0.72); } catch (e) { return null; }
  }

  /** 给某片段抓关键帧（seek 到 in+0.1 抓，再回到原位） */
  async function captureShotThumb(shot) {
    const v = U.$('#video'); if (!v || !v.src) return null;
    const back = v.currentTime, wasPlaying = !v.paused;
    v.pause();
    await seekTo(v, Math.min(shot.in + 0.08, Math.max(0, shot.out - 0.02)));
    const data = grabFrame(320);
    await seekTo(v, back);
    if (wasPlaying) v.play();
    return data;
  }
  function seekTo(v, t) {
    return new Promise(res => {
      const done = () => { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      v.currentTime = t;
      setTimeout(done, 800);
    });
  }
  function setStatus(s) { const el = U.$('#statusBar'); if (el) el.textContent = s; }

  function init() {
    const fi = U.$('#fileInput'), dz = U.$('#dropZone');
    U.$('#btnImport').onclick = () => { pendingKeep = false; fi.click(); };
    fi.onchange = e => { const f = e.target.files[0]; if (f) importFile(f, { keepShots: pendingKeep }); fi.value = ''; };
    if (dz) dz.onclick = () => { pendingKeep = false; fi.click(); };

    /* 全窗口拖拽导入 */
    ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault(); if (dz) dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
      if (ev === 'drop') e.preventDefault();
      if (dz && (ev === 'drop' || e.relatedTarget === null)) dz.classList.remove('over');
    }));
    document.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (/\.json$/i.test(f.name)) { LP.exporter.importProjectFile(f); return; }
      pendingKeep = false; importFile(f);
    });

    /* 抓帧按钮：写入当前选中片段的附件字段（R-015 attachment） */
    U.$('#btnGrab').onclick = () => {
      const s = LP.state.current();
      const data = grabFrame(320);
      if (!data) return U.toast('抓帧失败：先导入视频', 'err');
      if (!s) return U.toast('请先在时间线选中一个片段', 'err');
      LP.state.push(); s.thumb = data; LP.state.commit('抓帧');
      U.toast('已抓帧 → 片段 ' + LP.timeline.indexOf(s.id), 'ok');
    };
  }

  return { init, importFile, tryRestore, grabFrame, captureShotThumb, judgeRatio, applyRatioUI, renderMediaCard, get url() { return objectUrl; } };
})();
