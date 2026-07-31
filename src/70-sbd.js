/* =========================================================================
 * 拉片台 LaPian Studio — 70 sbd
 * 自动镜头切分 Shot Boundary Detection（传统档：直方图差分 + 自适应阈值）
 *
 * 对应需求：
 *   R-003 自动切分镜头，结果铺满时间线（连续片段，首段从 0，末段到片尾）
 *   R-004 灵敏度滑块控制阈值：一次抽帧、缓存差分序列，之后调阈值纯计算秒回
 *   R-005 人工精修：对话框列表预览，逐切点勾选（取消=合并相邻两段），确认后才写入
 *   R-006 最短镜头时长过滤（默认 0.5s，0.2–5s 可调），压制运镜/抖动伪切点
 *
 * 隐私红线：抽帧、直方图、阈值判定全部在本机浏览器内完成，无任何网络请求。
 * ========================================================================= */
window.LP = window.LP || {};

LP.sbd = (function () {
  'use strict';

  var U = LP.util;

  /* ------------------------------------------------------------- 常量 */
  var BINS = 16;              // 每通道 16 bins（RGB 共 48 维）
  var FEAT = BINS * 3;
  var FRAME_W = 64;           // 抽帧缩放宽度，等比高
  var WIN = 15;               // 自适应阈值局部窗口：前后各 15 帧
  var TRIM = 0.8;             // 局部基线只用窗口内最小的 80%，避免邻近切点抬高基线
  var LONG_VIDEO = 600;       // 超过 10 分钟视为长视频，提示耗时
  var EPS = 1e-6;

  var DEF = { sampleFps: 3, minDur: 0.5, sens: 50 };

  /* ------------------------------------------------------------- 闭包状态 */
  var maskEl = null;          // 对话框根节点
  var inited = false;
  var running = false;
  var cancelFlag = false;

  var opts = { sampleFps: DEF.sampleFps, minDur: DEF.minDur, sens: DEF.sens, useRange: false };

  /** 抽帧缓存：R-004 的关键——阈值调整不再重新抽帧 */
  var cache = null;
  /* cache = {
       key, sampleFps, start, end, n,
       times : Float64Array(n)     每个采样帧的时间
       diffs : Float32Array(n)     diffs[i] = 帧 i-1 与帧 i 的综合差分（diffs[0]=0）
       mu, sd: Float32Array(n)     局部窗口均值/标准差（与灵敏度无关，只算一次）
     } */

  var cands = [];             // 当前阈值下的候选切点 [{t,score,idx}]
  var enabled = [];           // 与 cands 等长，人工精修的勾选状态（R-005）

  /* ============================================================ 基础工具 */

  function el(tag, attrs, children) { return U.el(tag, attrs, children); }
  function q(sel) { return maskEl ? maskEl.querySelector(sel) : null; }

  /** 取主视频的 ObjectURL（离屏抽帧复用同一个 URL，不打断用户正在看的播放器） */
  function videoUrl() {
    if (LP.media && LP.media.objectUrl) return LP.media.objectUrl;
    var v = document.querySelector('#video');
    if (v && v.src) return v.src;
    if (v && v.currentSrc) return v.currentSrc;
    return '';
  }

  function videoDuration() {
    var p = LP.state.project;
    var d = p && p.videoRef && p.videoRef.duration;
    if (isFinite(d) && d > 0) return d;
    var v = document.querySelector('#video');
    if (v && isFinite(v.duration) && v.duration > 0) return v.duration;
    return 0;
  }

  function hasVideo() { return !!videoUrl() && videoDuration() > 0; }

  /** 防御性探测主程序的入出点（各模块字段命名未定，多路兜底；探测不到就禁用区间选项） */
  function getInOut() {
    var holders = [LP.player, LP.viewer, LP.transport, LP.media, LP.state, LP];
    var inKeys = ['inPoint', 'tIn', 'markIn', 'inSec', 'in'];
    var outKeys = ['outPoint', 'tOut', 'markOut', 'outSec', 'out'];
    for (var h = 0; h < holders.length; h++) {
      var o = holders[h];
      if (!o || typeof o !== 'object') continue;
      var a = null, b = null, k;
      for (k = 0; k < inKeys.length; k++) if (typeof o[inKeys[k]] === 'number') { a = o[inKeys[k]]; break; }
      for (k = 0; k < outKeys.length; k++) if (typeof o[outKeys[k]] === 'number') { b = o[outKeys[k]]; break; }
      if (a != null && b != null && isFinite(a) && isFinite(b) && b - a > 0.3) return { in: a, out: b };
      if (o.io && typeof o.io === 'object' && isFinite(o.io.in) && isFinite(o.io.out) && o.io.out - o.io.in > 0.3) {
        return { in: o.io.in, out: o.io.out };
      }
    }
    return null;
  }

  /** 等一个事件（带超时与 error 兜底） */
  function once(target, ev, ms) {
    return new Promise(function (res, rej) {
      var done = false;
      function clean() {
        target.removeEventListener(ev, ok);
        target.removeEventListener('error', bad);
        clearTimeout(timer);
      }
      function ok() { if (done) return; done = true; clean(); res(); }
      function bad() { if (done) return; done = true; clean(); rej(new Error('MEDIA_ERROR')); }
      var timer = setTimeout(function () { if (done) return; done = true; clean(); rej(new Error('TIMEOUT')); }, ms || 15000);
      target.addEventListener(ev, ok);
      target.addEventListener('error', bad);
    });
  }

  /** 串行 seek：等 seeked 事件，避免并发 seek 抖动 */
  function seekTo(v, t) {
    return new Promise(function (res) {
      if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
      var done = false;
      function ok() { if (done) return; done = true; clean(); res(); }
      function clean() { v.removeEventListener('seeked', ok); clearTimeout(timer); }
      var timer = setTimeout(ok, 5000);   // 单帧超时也继续，不让整条流程卡死
      v.addEventListener('seeked', ok);
      try { v.currentTime = t; } catch (e) { ok(); }
    });
  }

  function secText(s) {
    s = Math.max(0, Math.round(s));
    if (s < 90) return s + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  }

  /* ============================================================ 特征与差分 */

  /**
   * 单帧特征：RGB 三通道 16-bins 直方图（各自归一化）+ 灰度均值
   * 返回 {h: Float32Array(48), lum: Number}
   *
   * 采用「线性软分箱」而非 v>>4 硬分箱：每个像素按其在箱内的亚位置，
   * 把权重按比例分给相邻两个箱。
   * 原因：硬分箱下，大面积同色画面在缓慢变亮/变暗时，所有像素会在同一瞬间
   * 整体跨过箱边界，直方图差分从 0 直接跳到满值，被误判成硬切
   * （表现为曝光漂移、灯光渐变、天色变化被切成一堆碎片）。
   * 软分箱让直方图随亮度连续平移，渐变不再产生阶跃，真正的硬切依然是尖峰。
   */
  function frameFeature(ctx, w, h) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data, len = d.length;
    var hist = new Float32Array(FEAT);
    var lum = 0, n = 0;
    var MAXB = BINS - 1;
    /* 把 0–255 映射到箱中心坐标：x = v/16 - 0.5，落在 [-0.5, 15.5] */
    function put(off, v) {
      var x = v * (1 / 16) - 0.5;
      var i0 = Math.floor(x);
      var f = x - i0;                       // 到下一个箱的距离，0–1
      if (i0 < 0) { hist[off] += 1; return; }
      if (i0 >= MAXB) { hist[off + MAXB] += 1; return; }
      hist[off + i0] += 1 - f;
      hist[off + i0 + 1] += f;
    }
    for (var i = 0; i < len; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      put(0, r);
      put(BINS, g);
      put(BINS * 2, b);
      lum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
    if (n > 0) for (var k = 0; k < FEAT; k++) hist[k] /= n;   // 每通道各自 sum=1
    return { h: hist, lum: n ? lum / n : 0 };
  }

  /** 直方图交叉距离（0–1）：1 - Σmin(a,b)，三通道平均 */
  function distIntersect(a, b) {
    var s = 0;
    for (var c = 0; c < 3; c++) {
      var inter = 0, off = c * BINS;
      for (var k = 0; k < BINS; k++) inter += Math.min(a[off + k], b[off + k]);
      s += 1 - inter;
    }
    return s / 3;
  }

  /** 卡方距离归一化到 0–1：Σ(a-b)²/(a+b) 上限为 2，除 2 */
  function distChi2(a, b) {
    var s = 0;
    for (var c = 0; c < 3; c++) {
      var v = 0, off = c * BINS;
      for (var k = 0; k < BINS; k++) {
        var x = a[off + k], y = b[off + k], sum = x + y;
        if (sum > EPS) { var d = x - y; v += d * d / sum; }
      }
      s += v / 2;
    }
    return U.clamp(s / 3, 0, 1);
  }

  /** 综合帧间差分：直方图为主（交叉+卡方各半），亮度突变作辅助信号 */
  function frameDiff(fa, fb) {
    var dh = 0.5 * distIntersect(fa.h, fb.h) + 0.5 * distChi2(fa.h, fb.h);
    var dl = Math.min(1, Math.abs(fa.lum - fb.lum) / 72);
    return U.clamp(0.85 * dh + 0.15 * dl, 0, 1);
  }

  /**
   * 局部窗口（前后各 WIN 帧，排除自身）的均值与标准差 —— 与灵敏度无关，只算一次。
   * 用「截尾」统计（丢掉窗口内最高的 20%）：快切段落里相邻切点会把普通均值抬得很高，
   * 导致该抬高的基线反过来把真切点吃掉；截尾后基线只反映"镜头内部的正常波动"。
   */
  function localStats(diffs) {
    var n = diffs.length;
    var mu = new Float32Array(n), sd = new Float32Array(n);
    var buf = [];
    for (var i = 0; i < n; i++) {
      var a = Math.max(1, i - WIN), b = Math.min(n - 1, i + WIN);
      buf.length = 0;
      for (var j = a; j <= b; j++) { if (j !== i) buf.push(diffs[j]); }
      if (!buf.length) { mu[i] = 0; sd[i] = 0; continue; }
      buf.sort(function (x, y) { return x - y; });
      var m = Math.min(buf.length, Math.max(3, Math.round(buf.length * TRIM)));
      var s = 0, s2 = 0;
      for (var k = 0; k < m; k++) { s += buf[k]; s2 += buf[k] * buf[k]; }
      var av = s / m, va = Math.max(0, s2 / m - av * av);
      mu[i] = av; sd[i] = Math.sqrt(va);
    }
    return { mu: mu, sd: sd };
  }

  /* ============================================================ 抽帧主流程 */

  /**
   * 整片（或选定区间）抽帧 → 差分序列。串行 seek，可取消。
   * onProgress(done,total,etaSec)
   */
  async function extract(cfg, onProgress) {
    var url = videoUrl();
    if (!url) throw new Error('NO_VIDEO');

    var v = document.createElement('video');
    var cv = document.createElement('canvas');
    var ctx = null;

    try {
      v.preload = 'auto';
      v.muted = true; v.defaultMuted = true; v.volume = 0;
      v.playsInline = true; v.setAttribute('playsinline', '');
      v.src = url;
      await once(v, 'loadeddata', 20000);

      var vw = v.videoWidth || 0, vh = v.videoHeight || 0;
      var w = FRAME_W;
      var h = vw > 0 ? Math.max(2, Math.round(FRAME_W * vh / vw)) : 36;
      cv.width = w; cv.height = h;
      ctx = cv.getContext('2d', { willReadFrequently: true });

      var start = cfg.start, end = cfg.end;
      var step = 1 / cfg.sampleFps;
      var n = Math.max(2, Math.floor((end - start) / step) + 1);

      var times = new Float64Array(n);
      var diffs = new Float32Array(n);
      var prev = null;
      var t0 = performance.now();

      for (var i = 0; i < n; i++) {
        if (cancelFlag) throw new Error('CANCELLED');
        var t = Math.min(end - 1e-3, start + i * step);
        times[i] = t;
        await seekTo(v, t);
        if (cancelFlag) throw new Error('CANCELLED');

        ctx.drawImage(v, 0, 0, w, h);
        var f;
        try {
          f = frameFeature(ctx, w, h);
        } catch (e) {
          throw new Error('TAINTED');           // 画布被污染（安全策略）
        }
        diffs[i] = prev ? frameDiff(prev, f) : 0;
        prev = f;

        if (onProgress && (i % 3 === 0 || i === n - 1)) {
          var el2 = (performance.now() - t0) / 1000;
          var eta = i > 2 ? el2 / (i + 1) * (n - i - 1) : 0;
          onProgress(i + 1, n, eta);
        }
      }

      var st = localStats(diffs);
      return {
        key: cfg.key, sampleFps: cfg.sampleFps, start: start, end: end, n: n,
        times: times, diffs: diffs, mu: st.mu, sd: st.sd
      };
    } finally {
      /* 清理离屏 video / canvas，防止内存泄漏（注意：ObjectURL 与主播放器共用，不能 revoke） */
      try { v.pause(); } catch (e) { }
      try { v.removeAttribute('src'); v.load(); } catch (e) { }
      try { cv.width = 0; cv.height = 0; } catch (e) { }
      ctx = null; cv = null; v = null;
    }
  }

  /* ============================================================ 切点判定 */

  /** 灵敏度 0–100 → 自适应系数 k 与绝对下限（对标达芬奇那条紫色阈值线） */
  function sensParams(s) {
    var r = U.clamp(s, 0, 100) / 100;
    return {
      k: 6.0 - 4.6 * r,                          // 6.0（保守）→ 1.4（激进）
      floor: 0.34 - 0.30 * Math.pow(r, 0.85),    // 0.34 → 0.04
      /* 相对倍率闸门：切点差分至少要达到局部基线的多少倍。
       * 为什么需要它：匀速变化的画面（灯光渐亮、天色变化、缓慢变焦、云层移动）
       * 会产生一串「幅度恒定」的差分，此时局部标准差趋近于 0，
       * 「均值 + k×标准差」这个阈值就退化成了均值本身，噪声会成片越线被切碎。
       * 加上倍率闸门后，只有明显高于周围水平的尖峰才算切点，匀速漂移天然被排除。 */
      ratio: 2.8 - 1.3 * r                        // 2.8（保守）→ 1.5（激进）
    };
  }

  /**
   * 从缓存的差分序列算切点：自适应阈值 + 非极大值抑制 + 最短镜头过滤
   * 纯计算，无 IO —— R-004 秒回的根据
   */
  function pickCuts(c, sens, minDur) {
    if (!c) return [];
    var p = sensParams(sens);
    var n = c.n, i;

    /* 1) 自适应阈值：显著高于局部基线才算硬切，整体偏亮/偏暗片段不会被误判 */
    var raw = [];
    for (i = 1; i < n; i++) {
      /* 三道闸门取最严：绝对下限 / 局部离群度 / 相对倍率 */
      var thr = Math.max(p.floor, c.mu[i] + p.k * c.sd[i], p.ratio * c.mu[i]);
      if (c.diffs[i] >= thr) raw.push(i);
    }

    /* 2) 非极大值抑制：连续多帧超阈值时只取最高峰 */
    var rad = Math.max(1, Math.round(c.sampleFps * 0.4));
    var order = raw.slice().sort(function (a, b) { return c.diffs[b] - c.diffs[a]; });
    var killed = {};
    var keep = [];
    for (i = 0; i < order.length; i++) {
      var idx = order[i];
      if (killed[idx]) continue;
      keep.push(idx);
      for (var j = idx - rad; j <= idx + rad; j++) if (j !== idx) killed[j] = 1;
    }
    keep.sort(function (a, b) { return a - b; });

    /* 3) 切点时刻取相邻两采样帧的中点，误差最小（精度 ≈ 1/(2·采样率)） */
    var list = keep.map(function (ix) {
      return { idx: ix, t: +(((c.times[ix - 1] + c.times[ix]) / 2)).toFixed(3), score: c.diffs[ix] };
    });

    /* 4) R-006 最短镜头过滤：反复剔除"造成过短片段"的最弱切点 */
    return applyMinDur(list, c.start, c.end, minDur);
  }

  function applyMinDur(list, start, end, minDur) {
    if (!(minDur > 0)) return list;
    var out = list.slice();
    var guard = 0;
    while (guard++ < 20000 && out.length) {
      var b = [start], i;
      for (i = 0; i < out.length; i++) b.push(out[i].t);
      b.push(end);
      var worst = -1, worstLen = Infinity;
      for (i = 0; i < b.length - 1; i++) {
        var len = b[i + 1] - b[i];
        if (len < minDur - 1e-6 && len < worstLen) { worstLen = len; worst = i; }
      }
      if (worst < 0) break;
      var L = worst - 1;                                  // 该段左界切点在 out 中的下标
      var R = worst < out.length ? worst : -1;            // 右界切点
      var del;
      if (L < 0) del = R;
      else if (R < 0) del = L;
      else del = (out[L].score <= out[R].score) ? L : R;
      if (del == null || del < 0) break;
      out.splice(del, 1);
    }
    return out;
  }

  /** 由勾选状态生成连续片段（R-003：铺满，首段从 start，末段到 end） */
  function buildSegments() {
    if (!cache) return [];
    var bs = [cache.start];
    for (var i = 0; i < cands.length; i++) if (enabled[i]) bs.push(cands[i].t);
    bs.push(cache.end);
    var segs = [];
    for (var j = 0; j < bs.length - 1; j++) {
      var a = +bs[j].toFixed(3), b = +bs[j + 1].toFixed(3);
      if (b - a > 0.02) segs.push({ in: a, out: b });
    }
    return segs;
  }

  /* ============================================================ 对话框 UI */

  function open() {
    if (maskEl) return;                                   // 已打开，忽略重复调用
    if (!hasVideo()) { U.toast('请先导入视频', 'err'); return; }
    buildModal();
    if (cache && cache.key === cacheKey()) {              // 同一视频/同参数：直接显示上次结果
      recompute();
      showStage('result');
    } else {
      showStage('setup');
    }
  }

  function cacheKey() {
    var p = LP.state.project, r = rangeOf();
    var vr = (p && p.videoRef) || {};
    return [vr.name || '', vr.size || 0, videoDuration().toFixed(3), opts.sampleFps, r.start.toFixed(3), r.end.toFixed(3)].join('|');
  }

  function rangeOf() {
    var dur = videoDuration();
    var io = opts.useRange ? getInOut() : null;
    if (io) return { start: U.clamp(io.in, 0, dur), end: U.clamp(io.out, 0, dur) };
    return { start: 0, end: dur };
  }

  function buildModal() {
    var dur = videoDuration();
    var io = getInOut();
    var longV = dur > LONG_VIDEO;

    maskEl = el('div', { class: 'mask' });
    maskEl.innerHTML =
      '<div class="modal" style="width:min(920px,95vw)">' +
      '  <div class="modal-hd">' +
      '    <h3>自动切分镜头</h3>' +
      '    <span class="badge">本地计算 · 素材不出机</span>' +
      '    <span class="grow"></span>' +
      '    <span class="badge">R-003 / R-004 / R-005 / R-006</span>' +
      '  </div>' +
      '  <div class="modal-bd">' +

      '    <div class="card" style="padding:9px 12px;margin-bottom:11px">' +
      '      <div style="font-size:12px;color:var(--txt2);line-height:1.75">' +
      '        本工具做的是<b style="color:var(--txt)">镜头边界检测</b>（切镜头），不是内容理解型的 AI 高光切片；自动结果一定要人工精修。' +
      '      </div>' +
      '    </div>' +

      /* ---------- 参数区 ---------- */
      '    <div id="sbdSetup">' +
      '      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:11px">' +
      '        <div class="stat"><div class="sv" style="font-size:15px">' + U.esc(U.dur(dur)) + '</div><div class="sl">视频时长</div></div>' +
      '        <div class="stat"><div class="sv" style="font-size:15px" id="sbdFrameEst">—</div><div class="sl">预计抽帧数</div></div>' +
      '        <div class="stat"><div class="sv" style="font-size:15px">' + (LP.state.project.shots.length) + '</div><div class="sl">现有片段</div></div>' +
      '      </div>' +
      '      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">' +
      '        <label style="display:block">' +
      '          <div style="font-size:11.5px;color:var(--txt2);margin-bottom:4px">采样率（越高越准、越慢）</div>' +
      '          <select id="sbdFps" class="mini-input">' +
      '            <option value="2">2 fps · 最快</option>' +
      '            <option value="3" selected>3 fps · 推荐</option>' +
      '            <option value="4">4 fps · 更准</option>' +
      '          </select>' +
      '        </label>' +
      '        <div>' +
      '          <div style="font-size:11.5px;color:var(--txt2);margin-bottom:4px">最短镜头时长（R-006）<span id="sbdMinLb" style="color:var(--accent);font-family:var(--mono)"> 0.5s</span></div>' +
      '          <input type="range" id="sbdMin" min="0.2" max="5" step="0.1" value="0.5" style="width:100%">' +
      '        </div>' +
      '      </div>' +
      '      <div style="margin-top:9px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '        <label class="chk"><input type="checkbox" id="sbdRange"' + (io ? '' : ' disabled') + '> 仅分析当前入出点区间' +
      (io ? '<span class="pool-tc" style="margin-left:4px">' + U.esc(U.tc(io.in)) + ' – ' + U.esc(U.tc(io.out)) + '</span>'
        : '<span class="pool-tc" style="margin-left:4px">（未设置入出点）</span>') +
      '        </label>' +
      '      </div>' +
      (longV
        ? '      <div class="badge risk" style="display:block;margin-top:10px;padding:6px 9px;line-height:1.7">' +
        '        这是一条长视频（' + U.esc(U.dur(dur)) + '）。整片抽帧需要逐帧 seek，可能耗时数分钟；建议先设好入出点，只分析要拉的段落。' +
        '      </div>'
        : '') +
      '    </div>' +

      /* ---------- 进度区 ---------- */
      '    <div id="sbdProg" hidden>' +
      '      <div style="font-size:12.5px;color:var(--txt2)" id="sbdProgTxt">准备中…</div>' +
      '      <div class="prog"><i id="sbdProgBar"></i></div>' +
      '      <div class="pool-tc" style="margin-top:6px">正在本机解码抽帧，未发生任何网络传输。</div>' +
      '    </div>' +

      /* ---------- 结果区 ---------- */
      '    <div id="sbdResult" hidden>' +
      '      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">' +
      '        <div style="flex:1;min-width:240px">' +
      '          <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--txt2)">' +
      '            <span>灵敏度（R-004 · 阈值线）</span><span id="sbdSensLb" class="pool-tc"></span>' +
      '          </div>' +
      '          <input type="range" id="sbdSens" min="0" max="100" step="1" value="50" style="width:100%">' +
      '          <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--txt3)"><span>保守 · 少切</span><span>激进 · 多切</span></div>' +
      '        </div>' +
      '        <div style="flex:1;min-width:200px">' +
      '          <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--txt2)">' +
      '            <span>最短镜头（R-006）</span><span id="sbdMin2Lb" class="pool-tc"></span>' +
      '          </div>' +
      '          <input type="range" id="sbdMin2" min="0.2" max="5" step="0.1" value="0.5" style="width:100%">' +
      '          <div style="font-size:10.5px;color:var(--txt3)">调整这两项<b>不会</b>重新抽帧，实时重算。</div>' +
      '        </div>' +
      '      </div>' +
      '      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)">' +
      '        <b id="sbdCount" style="color:var(--accent)">—</b>' +
      '        <span class="pool-tc" id="sbdMeta"></span>' +
      '        <span class="grow"></span>' +
      '        <button class="btn xs" id="sbdAll">全选切点</button>' +
      '        <button class="btn xs" id="sbdNone">全不选</button>' +
      '      </div>' +
      '      <div style="display:flex;gap:7px;padding:3px 6px;font-size:10.5px;color:var(--txt3);border-bottom:1px solid var(--line)">' +
      '        <span style="width:16px"></span><span style="width:38px">序号</span><span style="width:98px">入点</span>' +
      '        <span style="width:98px">出点</span><span style="width:62px">时长</span><span style="flex:1">切点差分强度</span>' +
      '      </div>' +
      '      <div id="sbdList" style="max-height:266px;overflow:auto;padding:3px 0"></div>' +
      '      <div class="pool-tc" style="margin-top:7px">取消勾选某个切点 = 把它前后两段合并（R-005）。切点精度约 ±<span id="sbdPrec">0.17</span>s，写入后可在时间线上手动微调。</div>' +
      '    </div>' +

      '  </div>' +
      '  <div class="modal-ft">' +
      '    <span class="grow"></span>' +
      '    <button class="btn" id="sbdClose">关闭</button>' +
      '    <button class="btn" id="sbdCancel" hidden>取消分析</button>' +
      '    <button class="btn" id="sbdRedo" hidden>重新抽帧</button>' +
      '    <button class="btn accent" id="sbdRun">开始分析</button>' +
      '    <button class="btn accent" id="sbdApply" hidden>写入工程</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(maskEl);

    /* --- 参数区交互 --- */
    var fps = q('#sbdFps'), mn = q('#sbdMin'), rg = q('#sbdRange');
    fps.value = String(opts.sampleFps);
    mn.value = String(opts.minDur);
    rg.checked = !!(opts.useRange && io);
    q('#sbdMinLb').textContent = ' ' + (+mn.value).toFixed(1) + 's';
    updateFrameEst();

    fps.addEventListener('change', function () { opts.sampleFps = +fps.value; updateFrameEst(); });
    mn.addEventListener('input', function () {
      opts.minDur = +mn.value;
      q('#sbdMinLb').textContent = ' ' + opts.minDur.toFixed(1) + 's';
    });
    rg.addEventListener('change', function () { opts.useRange = rg.checked; updateFrameEst(); });

    /* --- 结果区交互（纯计算，秒回） --- */
    var sens = q('#sbdSens'), mn2 = q('#sbdMin2');
    sens.value = String(opts.sens);
    mn2.value = String(opts.minDur);
    sens.addEventListener('input', function () { opts.sens = +sens.value; recompute(); });
    mn2.addEventListener('input', function () { opts.minDur = +mn2.value; recompute(); });

    q('#sbdAll').addEventListener('click', function () { setAll(true); });
    q('#sbdNone').addEventListener('click', function () { setAll(false); });
    q('#sbdList').addEventListener('change', onRowToggle);

    /* --- 底部按钮 --- */
    q('#sbdRun').addEventListener('click', runAnalyze);
    q('#sbdRedo').addEventListener('click', function () { cache = null; showStage('setup'); });
    q('#sbdCancel').addEventListener('click', function () { cancelFlag = true; });
    q('#sbdClose').addEventListener('click', close);
    q('#sbdApply').addEventListener('click', apply);

    maskEl.addEventListener('mousedown', function (e) { if (e.target === maskEl && !running) close(); });
    document.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!maskEl) return;
    if (e.key === 'Escape') {
      e.stopPropagation(); e.preventDefault();
      if (running) cancelFlag = true; else close();
    }
  }

  function close() {
    if (!maskEl) return;
    cancelFlag = true;
    document.removeEventListener('keydown', onKey, true);
    maskEl.remove();
    maskEl = null;
  }

  function updateFrameEst() {
    if (!maskEl) return;
    var r = rangeOf();
    var n = Math.max(2, Math.floor((r.end - r.start) / (1 / opts.sampleFps)) + 1);
    var box = q('#sbdFrameEst');
    if (box) box.textContent = n + ' 帧';
  }

  function showStage(stage) {
    if (!maskEl) return;
    var map = {
      setup: { sbdSetup: 1, sbdProg: 0, sbdResult: 0, sbdRun: 1, sbdCancel: 0, sbdRedo: 0, sbdApply: 0, sbdClose: 1 },
      busy: { sbdSetup: 0, sbdProg: 1, sbdResult: 0, sbdRun: 0, sbdCancel: 1, sbdRedo: 0, sbdApply: 0, sbdClose: 0 },
      result: { sbdSetup: 0, sbdProg: 0, sbdResult: 1, sbdRun: 0, sbdCancel: 0, sbdRedo: 1, sbdApply: 1, sbdClose: 1 }
    }[stage];
    for (var id in map) {
      var n = q('#' + id);
      if (n) n.hidden = !map[id];
    }
  }

  /* ============================================================ 分析执行 */

  async function runAnalyze() {
    if (running) { U.toast('上一次分析正在收尾，稍等一下'); return; }
    if (!hasVideo()) { U.toast('请先导入视频', 'err'); return; }
    running = true; cancelFlag = false;
    showStage('busy');
    var bar = q('#sbdProgBar'), txt = q('#sbdProgTxt');
    var r = rangeOf();

    try {
      var data = await extract(
        { key: cacheKey(), sampleFps: opts.sampleFps, start: r.start, end: r.end },
        function (done, total, eta) {
          if (!maskEl) return;
          bar.style.width = (done / total * 100).toFixed(1) + '%';
          txt.textContent = '已分析 ' + done + '/' + total + ' 帧 · 预计剩余 ' + secText(eta);
        }
      );
      cache = data;
      if (!maskEl) return;
      recompute();
      showStage('result');
      U.toast('抽帧完成，共 ' + data.n + ' 帧');
    } catch (err) {
      if (!maskEl) return;
      var msg = String(err && err.message);
      if (msg === 'CANCELLED') { U.toast('已取消分析'); showStage('setup'); }
      else if (msg === 'TAINTED') { U.toast('浏览器安全策略阻止读取视频帧，无法分析', 'err'); showStage('setup'); }
      else if (msg === 'NO_VIDEO') { U.toast('请先导入视频', 'err'); showStage('setup'); }
      else { console.error('[sbd]', err); U.toast('抽帧失败：' + msg, 'err'); showStage('setup'); }
    } finally {
      running = false; cancelFlag = false;
    }
  }

  /** R-004：阈值/最短时长变化 → 只重算，不重新抽帧 */
  function recompute() {
    if (!cache) return;
    cands = pickCuts(cache, opts.sens, opts.minDur);
    enabled = cands.map(function () { return true; });
    renderResult();
  }

  function setAll(v) {
    enabled = cands.map(function () { return !!v; });
    renderResult();
  }

  function onRowToggle(e) {
    var t = e.target;
    if (!t || t.type !== 'checkbox') return;
    var i = +t.getAttribute('data-i');
    if (isNaN(i) || i < 0 || i >= enabled.length) return;
    enabled[i] = t.checked;
    renderResult();
  }

  function renderResult() {
    if (!maskEl || !cache) return;
    var p = sensParams(opts.sens);
    var on = enabled.filter(Boolean).length;

    q('#sbdSensLb').textContent = opts.sens + ' · k=' + p.k.toFixed(1) + ' · 下限 ' + p.floor.toFixed(2) + ' · 倍率 ' + p.ratio.toFixed(1) + '×';
    q('#sbdMin2Lb').textContent = opts.minDur.toFixed(1) + 's';
    var m1 = q('#sbdMin'); if (m1) { m1.value = String(opts.minDur); q('#sbdMinLb').textContent = ' ' + opts.minDur.toFixed(1) + 's'; }
    q('#sbdPrec').textContent = (0.5 / cache.sampleFps).toFixed(2);
    q('#sbdCount').textContent = '当前将切出 ' + (on + 1) + ' 个镜头';
    q('#sbdMeta').textContent = '采样 ' + cache.n + ' 帧 @' + cache.sampleFps + 'fps · 候选切点 ' + cands.length +
      ' · 已启用 ' + on + ' · 区间 ' + U.tc(cache.start) + ' – ' + U.tc(cache.end);
    renderList();
  }

  function renderList() {
    var box = q('#sbdList');
    if (!box) return;
    var i;

    /* 行 = 候选切点开出来的段；未勾选的行标为"并入上一段"，行序稳定不跳动 */
    var rows = [{ cut: -1, tIn: cache.start }];   // 第一行是片头，没有切点
    for (i = 0; i < cands.length; i++) rows.push({ cut: i, tIn: cands[i].t });

    var effIdx = 0;
    var html = '';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var isOn = r.cut < 0 ? true : !!enabled[r.cut];
      var tIn = r.tIn, tOut = cache.end;
      if (isOn) {
        for (var j = i + 1; j < rows.length; j++) {
          if (rows[j].cut >= 0 && enabled[rows[j].cut]) { tOut = rows[j].tIn; break; }
        }
        effIdx++;
      }
      var sc = r.cut < 0 ? 0 : cands[r.cut].score;
      var pct = Math.round(U.clamp(sc, 0, 1) * 100);
      var dim = isOn ? '' : 'opacity:.42;';

      html += '<label class="pool-item" style="gap:7px;' + dim + '">' +
        (r.cut < 0
          ? '<span style="width:16px;text-align:center;color:var(--txt3)">·</span>'
          : '<input type="checkbox" data-i="' + r.cut + '"' + (isOn ? ' checked' : '') + ' style="width:16px">') +
        '<span class="pool-idx" style="width:38px">' + (isOn ? '#' + effIdx : '—') + '</span>' +
        '<span class="pool-tc" style="width:98px">' + U.esc(U.tc(tIn)) + '</span>' +
        '<span class="pool-tc" style="width:98px">' + (isOn ? U.esc(U.tc(tOut)) : '<span style="color:var(--txt3)">↑ 并入上一段</span>') + '</span>' +
        '<span class="pool-tc" style="width:62px">' + (isOn ? U.esc(U.dur(tOut - tIn)) : '') + '</span>' +
        '<span style="flex:1;display:flex;align-items:center;gap:6px">' +
        (r.cut < 0
          ? '<span class="pool-tc" style="color:var(--txt3)">片头</span>'
          : '<span class="prog" style="margin:0;flex:1;max-width:120px"><i style="width:' + pct + '%;background:' +
          (sc >= 0.5 ? 'var(--ok)' : sc >= 0.3 ? 'var(--warn)' : 'var(--danger)') + '"></i></span>' +
          '<span class="pool-tc" style="width:38px">' + sc.toFixed(2) + '</span>') +
        '</span>' +
        '</label>';
    }
    box.innerHTML = html;
  }

  /* ============================================================ 写入工程 */

  function apply() {
    var segs = buildSegments();
    if (!segs.length) { U.toast('没有可写入的片段', 'err'); return; }
    var existing = LP.state.project.shots.length;
    if (!existing) return writeShots(segs, 'replace');
    askMode(segs.length, existing, function (mode) { if (mode) writeShots(segs, mode); });
  }

  /** 已有片段时询问：替换全部 / 追加保留 */
  function askMode(nNew, nOld, cb) {
    var m = el('div', { class: 'mask', style: 'z-index:320' });
    m.innerHTML =
      '<div class="modal" style="min-width:min(420px,92vw)">' +
      '  <div class="modal-hd"><h3>工程里已有 ' + nOld + ' 个片段</h3></div>' +
      '  <div class="modal-bd">' +
      '    <div style="font-size:12.5px;color:var(--txt2);line-height:1.8">本次将写入 <b style="color:var(--accent)">' + nNew + '</b> 个新片段，怎么处理已有内容？</div>' +
      '    <div class="mode" data-m="replace"><div class="m-t">替换全部</div><div class="m-d">清空现有片段与段落组，用自动切分结果重建时间线。已填的维度标注会一起丢失（可 Cmd/Ctrl+Z 撤销）。</div></div>' +
      '    <div class="mode" data-m="append"><div class="m-t">追加保留</div><div class="m-d">保留现有片段，只补写不与它们重叠的新片段；重叠的自动跳过。</div></div>' +
      '  </div>' +
      '  <div class="modal-ft"><button class="btn" data-m="">取消</button></div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var n = e.target.closest ? e.target.closest('[data-m]') : null;
      if (!n && e.target !== m) return;
      var mode = n ? n.getAttribute('data-m') : '';
      m.remove();
      cb(mode || null);
    });
  }

  function writeShots(segs, mode) {
    LP.state.push();
    var p = LP.state.project;
    var added = 0, skipped = 0;

    if (mode === 'replace') {
      p.shots = segs.map(function (s) { return LP.model.newShot(s.in, s.out); });
      p.groups = [];                                  // 成员片段已全部消失，空组一并清掉
      added = p.shots.length;
    } else {
      var old = p.shots.slice();
      segs.forEach(function (s) {
        var hit = old.some(function (o) { return s.in < o.out - 1e-3 && o.in < s.out - 1e-3; });
        if (hit) { skipped++; return; }
        p.shots.push(LP.model.newShot(s.in, s.out));
        added++;
      });
    }

    LP.state.commit('自动切分');
    if (mode === 'replace') LP.state.select([], null);
    U.toast('已切出 ' + added + ' 个镜头' + (skipped ? '（跳过 ' + skipped + ' 个重叠片段）' : ''), 'ok');
    close();
  }

  /* ============================================================ 编程接口 */

  /**
   * 无 UI 的检测接口：抽帧 + 判定，返回切点与片段（不写工程）
   * opts: {sampleFps, minDur, sens, start, end, onProgress}
   */
  async function detect(o) {
    o = o || {};
    var dur = videoDuration();
    /* 容忍直观别名：fps→sampleFps，sensitivity→sens，minShot/minLen→minDur */
    var sampleFps = o.sampleFps != null ? o.sampleFps
      : (o.fps != null ? o.fps : DEF.sampleFps);
    var sens = o.sens != null ? o.sens
      : (o.sensitivity != null ? o.sensitivity : DEF.sens);
    var minDur = o.minDur != null ? o.minDur
      : (o.minShot != null ? o.minShot : (o.minLen != null ? o.minLen : DEF.minDur));
    var cfg = {
      sampleFps: sampleFps,
      minDur: minDur,
      sens: sens,
      start: U.clamp(o.start || 0, 0, dur),
      end: U.clamp(o.end == null ? dur : o.end, 0, dur)
    };
    if (!(cfg.end - cfg.start > 0.1)) throw new Error('NO_VIDEO');
    cancelFlag = false;
    var data = await extract({ key: 'api', sampleFps: cfg.sampleFps, start: cfg.start, end: cfg.end }, o.onProgress || null);
    var cuts = pickCuts(data, cfg.sens, cfg.minDur);
    var bs = [data.start].concat(cuts.map(function (c) { return c.t; }), [data.end]);
    var segments = [];
    for (var i = 0; i < bs.length - 1; i++) {
      if (bs[i + 1] - bs[i] > 0.02) segments.push({ in: +bs[i].toFixed(3), out: +bs[i + 1].toFixed(3) });
    }
    return { frames: data.n, sampleFps: data.sampleFps, cuts: cuts, segments: segments };
  }

  /* ============================================================ 初始化 */

  function init() {
    if (inited) return;
    inited = true;
    var btn = document.querySelector('#btnAutoCut');
    if (btn) btn.addEventListener('click', function () { open(); });
    if (LP.bus) LP.bus.on('project:loaded', function () { cache = null; cands = []; enabled = []; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);

  return { open: open, detect: detect, init: init };
})();
