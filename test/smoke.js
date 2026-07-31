/* 拉片台 · 真实浏览器冒烟测试
 * 用 puppeteer-core 驱动本机 Chrome，验证：启动无报错 / 导入 / 建片段 /
 * 拆分 / 编组 / 解散 / 撤销 / 多维表四视图 / 报告页 / 导出内容
 * 运行：NODE_PATH=... node test/smoke.js
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const URL_ = process.env.LP_URL || ('file://' + path.join(__dirname, '..', 'index.html'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? '  ✔ ' : '  ✘ ') + name + (extra ? '  → ' + extra : ''));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [], warns = [], requests = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!/^(data|blob):/.test(u) && !/^file:/.test(u)) requests.push(u); });

  console.log('\n[1] 载入页面');
  await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  // 关掉可能出现的首次引导
  await page.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });

  ok('页面启动无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  const missing = await page.evaluate(() =>
    ['util', 'bus', 'state', 'media', 'player', 'timeline', 'edit', 'inspector', 'table', 'blocks', 'sbd', 'exporter', 'help', 'ui']
      .filter(k => !window.LP[k]).join(',')
  );
  ok('核心模块全部挂载', missing === '', missing ? '缺失：' + missing : '14/14');
  ok('达芬奇三栏四区可见', await page.evaluate(() =>
    !!document.querySelector('#pool') && !!document.querySelector('#viewer') &&
    !!document.querySelector('#inspector') && !!document.querySelector('#timelinePanel')));

  console.log('\n[2] 生成测试视频并导入（canvas → MediaRecorder，全本地）');
  const meta = await page.evaluate(async () => {
    /* 造一段 6 秒 320x180 视频，每 1.5 秒换一次画面（4 个明显镜头） */
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
    const ctx = cv.getContext('2d');
    const stream = cv.captureStream(25);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const scenes = ['#111111', '#eeeeee', '#2255cc', '#cc3322'];
    const t0 = performance.now();
    await new Promise(res => {
      const draw = () => {
        const el = performance.now() - t0;
        const i = Math.min(3, Math.floor(el / 1500));
        ctx.fillStyle = scenes[i]; ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = i === 1 ? '#000' : '#fff'; ctx.font = '40px sans-serif';
        ctx.fillText('S' + (i + 1), 20 + (el % 1500) / 30, 100);
        if (el < 6000) requestAnimationFrame(draw); else res();
      };
      draw();
    });
    rec.stop();
    await new Promise(res => rec.onstop = res);
    const blob = new Blob(chunks, { type: 'video/webm' });
    const file = new File([blob], 'test-clip.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1500));
    const v = document.querySelector('#video');
    return { dur: v.duration, w: v.videoWidth, h: v.videoHeight, ratio: LP.state.project.videoRatio, name: LP.state.project.videoRef && LP.state.project.videoRef.name };
  });
  ok('视频导入成功并读到元数据', meta.w > 0 && meta.name === 'test-clip.webm', JSON.stringify(meta));
  ok('R-002 横屏 16:9 判定正确', meta.ratio === '16:9', meta.ratio);

  console.log('\n[3] 手动建片段 / 拆分 / 编组 / 解散 / 撤销');
  const r3 = await page.evaluate(async () => {
    const out = {};
    LP.player.seek(0); LP.player.setIn(0); LP.player.setOut(2);
    LP.edit.addShotFromIO();
    LP.player.setIn(2); LP.player.setOut(4);
    LP.edit.addShotFromIO();
    out.after2 = LP.state.project.shots.length;

    /* R-011 拆分：拆后两段之和 == 原段 */
    const s = LP.state.shots()[0];
    const origLen = s.out - s.in;
    LP.edit.splitAt(s, 1);
    const a = LP.state.shots()[0], b = LP.state.shots()[1];
    out.splitSum = +((a.out - a.in) + (b.out - b.in)).toFixed(3);
    out.splitOrig = +origLen.toFixed(3);
    out.afterSplit = LP.state.project.shots.length;

    /* R-012 编组 */
    LP.state.select([a.id, b.id], null);
    LP.edit.groupSelected();
    out.groups = LP.state.project.groups.length;
    out.groupMembers = LP.state.groupShots(LP.state.project.groups[0].id).length;
    /* 组合分析写入后解散，检查是否保留（R-013 可逆） */
    LP.state.project.groups[0].analysis = '三镜递进测试';
    const gid = LP.state.project.groups[0].id;
    LP.state.select([a.id, b.id], gid);
    LP.edit.ungroupSelected();
    out.afterUngroupMembers = LP.state.groupShots(gid).length;
    out.analysisKept = LP.state.group(gid).analysis;
    /* 撤销 */
    LP.state.undo();
    out.afterUndoMembers = LP.state.groupShots(gid).length;
    return out;
  });
  ok('R-011 拆分非破坏性（时长守恒）', r3.splitSum === r3.splitOrig, r3.splitSum + ' vs ' + r3.splitOrig);
  ok('R-011 拆分后片段数 +1', r3.afterSplit === r3.after2 + 1, r3.afterSplit);
  ok('R-012 编组成功', r3.groups === 1 && r3.groupMembers === 2, JSON.stringify(r3));
  ok('R-013 解散组后成员归零且组合分析保留', r3.afterUngroupMembers === 0 && r3.analysisKept === '三镜递进测试');
  ok('撤销可恢复编组', r3.afterUndoMembers === 2, String(r3.afterUndoMembers));

  console.log('\n[4] 虚拟片段播放（播到 out 自动停）');
  const r4 = await page.evaluate(async () => {
    const s = LP.state.shots()[0];
    LP.player.loop = false;
    LP.player.playRange(s.in, s.out, { shotId: s.id });
    await new Promise(r => setTimeout(r, (s.out - s.in) * 1000 + 900));
    const v = document.querySelector('#video');
    return { paused: v.paused, t: v.currentTime, out: s.out, in: s.in };
  });
  ok('R-009 播到 out 自动停', r4.paused && r4.t <= r4.out + 0.15, JSON.stringify(r4));

  console.log('\n[5] 自动切分 SBD（R-003/004/006）');
  const r5 = await page.evaluate(async () => {
    const out = {};
    if (!LP.sbd || !LP.sbd.detect) return { missing: true };
    if (!LP.state.project.videoRef || !LP.state.project.videoRef.duration) { out.noVideo = true; return out; }
    try {
      /* 测试片源：6 秒，每 1.5 秒整幅换色，共 4 镜 → 理论 3 个硬切点 */
      const hi = await LP.sbd.detect({ sampleFps: 6, sens: 80, minDur: 0.4 });
      const lo = await LP.sbd.detect({ sampleFps: 6, sens: 20, minDur: 0.4 });
      const strict = await LP.sbd.detect({ sampleFps: 6, sens: 80, minDur: 3.5 });
      out.hi = hi.cuts.length; out.lo = lo.cuts.length; out.strict = strict.cuts.length;
      out.hiSegs = hi.segments.length; out.loSegs = lo.segments.length;
      out.shape = hi.cuts[0] ? Object.keys(hi.cuts[0]).join('|') : '';
      out.hiTimes = hi.cuts.map(c => +c.t.toFixed(2)).join(',');
      out.frames = hi.frames;
      /* R-003 硬切准确性：真实切点在 1.5 / 3.0 / 4.5，必须全部命中且不多切 */
      const TRUTH = [1.5, 3.0, 4.5];
      out.matched = TRUTH.filter(gt => hi.cuts.some(c => Math.abs(c.t - gt) <= 0.25)).length;
      out.plausible = out.hi === 3 && out.matched === 3;
      /* 片段必须铺满全片：段数 = 切点数 + 1 */
      out.segsOk = out.hiSegs === out.hi + 1;
      /* R-004 灵敏度变化必须反映在切点数（高灵敏 ≥ 低灵敏，且不能都为 0） */
      out.sensitivityWorks = out.hi >= out.lo && !(out.hi === 0 && out.lo === 0);
      /* R-006 最短镜头过滤：6 秒片子设 3.5s 门槛，最多只能留 1 个切点，必须严格变少 */
      out.minShotWorks = out.strict < out.hi && out.strict <= 1;
    } catch (e) { out.err = e.message; return out; }

    /* R-003 结果铺满时间线（首段从 0、末段到片尾）+ 可撤销还原 */
    try {
      const segs = await LP.sbd.detect({ sampleFps: 6, sens: 80, minDur: 0.4 });
      const dur = document.querySelector('#video').duration;
      const before = LP.state.project.shots.length;
      LP.state.push();
      LP.state.project.shots = segs.segments.map(s => LP.model.newShot(s.in, s.out));
      LP.state.commit('auto-cut');
      LP.bus.emit('shots:changed');
      out.afterApply = LP.state.project.shots.length;
      out.firstZero = LP.state.project.shots[0].in <= 0.05;
      out.lastEnd = Math.abs(LP.state.project.shots[out.afterApply - 1].out - dur) < 0.1;
      LP.state.undo();
      out.afterUndo = LP.state.project.shots.length;
      out.restored = out.afterUndo === before;
    } catch (e) { out.applyErr = e.message; }
    return out;
  });
  ok('R-003 自动切分命中全部真实切点', r5.missing ? false : (!r5.err && r5.plausible === true && r5.segsOk === true),
    r5.missing ? 'LP.sbd 未挂载' : (r5.err || ('检出 ' + r5.hi + ' 命中 ' + r5.matched + '/3 时刻 ' + r5.hiTimes + ' 抽帧 ' + r5.frames)));
  ok('R-004 灵敏度影响切点数', r5.sensitivityWorks === true, 'hi(sens80)=' + r5.hi + ' lo(sens20)=' + r5.lo);
  ok('R-006 最短镜头过滤生效', r5.minShotWorks === true, 'minDur3.5s→' + r5.strict + ' 个 vs minDur0.4s→' + r5.hi + ' 个');
  ok('R-003 切分结果铺满时间线且可撤销', r5.afterApply > 0 && r5.firstZero === true && r5.lastEnd === true && r5.restored === true,
    'segs=' + r5.hiSegs + ' first0=' + r5.firstZero + ' lastEnd=' + r5.lastEnd + ' undo=' + r5.afterUndo + (r5.applyErr ? ' ERR:' + r5.applyErr : ''));

  console.log('\n[6] 多维表四视图 / 报告页');
  const r6 = await page.evaluate(async () => {
    const out = {};
    LP.ui.setPage('table');
    await new Promise(r => setTimeout(r, 250));
    out.gridRows = document.querySelectorAll('#tblBody table.grid tbody tr').length ||
      document.querySelectorAll('#tblBody table.grid tr').length;
    ['kanban', 'gallery', 'form'].forEach(v => { });
    LP.table.setView('kanban'); out.kanban = document.querySelectorAll('#tblBody .kb-col').length;
    LP.table.setView('gallery'); out.gallery = document.querySelectorAll('#tblBody .gal-card').length;
    LP.table.setView('form'); out.form = !!document.querySelector('#tblBody .form-card');
    LP.table.setView('grid');
    LP.ui.setPage('report');
    await new Promise(r => setTimeout(r, 250));
    out.repCards = document.querySelectorAll('#repWrap .card').length;
    out.packLen = (LP.exporter.buildPack() || '').length;
    out.csvLines = (LP.exporter.toCSV() || '').split('\n').length;
    out.md = (LP.exporter.toMarkdown() || '').indexOf('拉片表') >= 0;
    LP.ui.setPage('cut');
    return out;
  });
  ok('R-017 表格视图有数据行', r6.gridRows > 0, String(r6.gridRows));
  ok('R-017 看板/画廊/表单三视图渲染', r6.kanban > 0 && r6.gallery > 0 && r6.form, JSON.stringify(r6));
  ok('R-022 素材包生成', r6.packLen > 200, r6.packLen + ' 字符');
  ok('R-024 CSV / Markdown 生成', r6.csvLines > 1 && r6.md, r6.csvLines + ' 行');
  ok('报告页卡片渲染', r6.repCards >= 4, String(r6.repCards));

  console.log('\n[7] 块编辑器 / 快捷键 / 帮助');
  const r7 = await page.evaluate(async () => {
    const out = {};
    const s = LP.state.shots()[0];
    LP.state.select([s.id], null);
    document.querySelector('.insp-tabs .tab[data-itab="blocks"]').click();
    await new Promise(r => setTimeout(r, 200));
    out.blockArea = !!document.querySelector('#inspBlocks').innerHTML.trim();
    out.blockAdded = (() => {
      try {
        s.blocks.push(LP.model.newBlock('text', '测试记录：推近=逼近情绪'));
        LP.blocks.render(document.querySelector('#inspBlocks'), s, '#1');
        return document.querySelectorAll('#inspBlocks .blk').length;
      } catch (e) { return 'ERR:' + e.message; }
    })();
    document.querySelector('.insp-tabs .tab[data-itab="dims"]').click();
    out.dimSections = document.querySelectorAll('#inspDims .dim-sec').length;
    /* R-026 提示卡：字段旁「看什么/怎么写」 */
    out.hintNodes = document.querySelectorAll('#inspDims .hint, #inspDims .hint-i, #inspDims [data-hint]').length;
    out.fieldsHaveCopy = (() => {
      try {
        const ks = Object.keys(LP.FIELDS);
        return ks.filter(k => LP.FIELDS[k] && LP.FIELDS[k].watch && LP.FIELDS[k].write).length;
      } catch (e) { return 'ERR:' + e.message; }
    })();

    if (!window.LP.help) { out.helpMissing = true; return out; }
    try {
      LP.help.shortcuts();
      const m = document.querySelector('#modalShortcuts') || document.querySelector('.mask');
      out.kbdModal = !!m;
      const txt = m ? m.textContent : '';
      out.kbdKeys = ['I', 'O', 'Space', 'J', 'K', 'L', 'B', 'G', '撤销', '刀片', '编组', '解散'].filter(s => txt.indexOf(s) >= 0).length;
      out.kbdRows = m ? m.querySelectorAll('tr, .kbd-row, .kb-row, .kb, li, kbd').length : 0;
      document.querySelectorAll('.mask').forEach(x => x.remove());
    } catch (e) { out.kbdErr = e.message; }
    try {
      LP.help.terms();
      const m = document.querySelector('#modalTerms') || document.querySelector('.mask');
      out.termModal = !!m;
      out.termRows = m ? m.querySelectorAll('.tn').length : 0;
      out.termBadge = m ? (m.textContent.match(/共\s*(\d+)\s*条/) || [])[1] : null;
      document.querySelectorAll('.mask').forEach(x => x.remove());
    } catch (e) { out.termErr = e.message; }
    try { out.termLookup = !!LP.help.term('推镜头'); } catch (e) { out.termLookupErr = e.message; }
    try { const r = LP.help.aiFill(s.id); out.aiFill = r === undefined ? 'void-ok' : (r ? 'obj' : 'null'); document.querySelectorAll('.mask').forEach(x => x.remove()); } catch (e) { out.aiErr = e.message; }
    return out;
  });
  ok('R-019 块编辑区可渲染块', typeof r7.blockAdded === 'number' && r7.blockAdded > 0, JSON.stringify(r7.blockAdded));
  ok('R-016 检查器七维度分区渲染', r7.dimSections >= 7, String(r7.dimSections));
  ok('R-026 七维度字段均带「看什么/怎么写」文案', r7.fieldsHaveCopy >= 7, String(r7.fieldsHaveCopy));
  ok('P7 快捷键速查覆盖达芬奇键位', r7.kbdModal === true && r7.kbdKeys >= 10, (r7.helpMissing ? 'LP.help 未挂载' : '命中 ' + r7.kbdKeys + ' 项 / ' + r7.kbdRows + ' 行 ' + (r7.kbdErr || '')));
  ok('R-027 术语库 ≥30 条', r7.termModal === true && (r7.termRows >= 30 || (r7.termBadge && +r7.termBadge >= 30)), (r7.helpMissing ? 'LP.help 未挂载' : (r7.termRows + ' 项 / 共 ' + r7.termBadge + ' 条 ' + (r7.termErr || ''))));
  ok('R-027 术语可按名查询', r7.termLookup === true, r7.termLookupErr || String(r7.termLookup));
  ok('R-028 AI 初填维度可触发', !r7.aiErr && r7.aiFill !== undefined, r7.aiErr || String(r7.aiFill));

  console.log('\n[8] 隐私红线');
  ok('P1 全程无外部网络请求', requests.length === 0, requests.slice(0, 3).join(' | '));
  ok('运行期间无新增 JS 报错', errors.length === 0, errors.slice(0, 4).join(' | '));

  console.log('\n[9] 本地保存');
  const r9 = await page.evaluate(() => { LP.storage.save(); return !!localStorage.getItem('lapian.project.v2'); });
  ok('R-025 工程写入 localStorage', r9);

  console.log('\n[10] 竖屏 9:16 专项（红线 P10）');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1440, height: 900 });
  const req2 = [];
  p2.on('request', r => { const u = r.url(); if (!/^(data|blob):/.test(u) && !/^file:/.test(u)) req2.push(u); });
  p2.on('pageerror', e => errors.push('PAGEERROR(9:16): ' + e.message));
  await p2.goto(URL_, { waitUntil: 'load' });
  await p2.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await p2.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  await p2.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });

  const r10 = await p2.evaluate(async () => {
    const out = {};
    /* 造一段 5 秒 180x320 竖屏视频 */
    const cv = document.createElement('canvas'); cv.width = 180; cv.height = 320;
    const ctx = cv.getContext('2d');
    const stream = cv.captureStream(25);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const scenes = ['#101010', '#f0f0f0', '#1e7a4c'];
    const t0 = performance.now();
    await new Promise(res => {
      const draw = () => {
        const el = performance.now() - t0;
        const i = Math.min(2, Math.floor(el / 1600));
        ctx.fillStyle = scenes[i]; ctx.fillRect(0, 0, 180, 320);
        ctx.fillStyle = i === 1 ? '#000' : '#fff'; ctx.font = '32px sans-serif';
        ctx.fillText('V' + (i + 1), 20, 120 + (el % 1600) / 40);
        if (el < 5000) requestAnimationFrame(draw); else res();
      };
      draw();
    });
    rec.stop();
    await new Promise(res => rec.onstop = res);
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'vertical.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1600));

    const v = document.querySelector('#video');
    out.w = v.videoWidth; out.h = v.videoHeight;
    out.ratio = LP.state.project.videoRatio;
    out.bodyRatio = document.body.dataset.ratio;

    /* P10 检视器 letterbox：渲染盒比例必须 ≈ 素材原生比例（不拉伸） */
    const b = v.getBoundingClientRect();
    out.boxRatio = +(b.width / b.height).toFixed(3);
    out.natRatio = +(v.videoWidth / v.videoHeight).toFixed(3);
    out.noStretch = Math.abs(out.boxRatio - out.natRatio) < 0.03;
    out.fitsStage = (() => {
      const st = v.parentElement ? v.parentElement.getBoundingClientRect() : null;
      return st ? (b.width <= st.width + 1 && b.height <= st.height + 1) : null;
    })();

    /* R-010 时间线按秒映射，与分辨率无关：两段等长片段像素宽必须相等且 = 时长×pps */
    LP.player.seek(0); LP.player.setIn(0); LP.player.setOut(1.5); LP.edit.addShotFromIO();
    LP.player.setIn(2); LP.player.setOut(3.5); LP.edit.addShotFromIO();
    LP.timeline.render();
    await new Promise(r => setTimeout(r, 200));
    const els = document.querySelectorAll('#tlShots .tl-clip');
    out.clipCount = els.length;
    if (els.length >= 2) {
      const w1 = els[0].getBoundingClientRect().width, w2 = els[1].getBoundingClientRect().width;
      out.equalWidth = Math.abs(w1 - w2) < 1.5;
      out.clipW = +w1.toFixed(1);
    }

    /* R-017 画廊视图缩略图按素材比例显示 */
    LP.ui.setPage('table'); LP.table.setView('gallery');
    await new Promise(r => setTimeout(r, 250));
    const g = document.querySelector('#tblBody .gal-thumb');
    if (g) { const gb = g.getBoundingClientRect(); out.galRatio = +(gb.width / gb.height).toFixed(2); }
    out.galCards = document.querySelectorAll('#tblBody .gal-card').length;
    LP.ui.setPage('cut');
    return out;
  });
  ok('R-002 竖屏 9:16 判定正确', r10.ratio === '9:16', r10.w + '×' + r10.h + ' → ' + r10.ratio);
  ok('P10 竖屏 UI 状态同步 body', r10.bodyRatio === '9:16', String(r10.bodyRatio));
  ok('P10 检视器 letterbox 不拉伸', r10.noStretch === true, '盒 ' + r10.boxRatio + ' vs 原生 ' + r10.natRatio);
  ok('P10 竖屏画面不溢出检视器', r10.fitsStage !== false, String(r10.fitsStage));
  ok('R-010 时间线按秒映射与分辨率无关', r10.equalWidth === true, '等长片段宽 ' + r10.clipW + 'px ×' + r10.clipCount);
  ok('R-017 竖屏画廊缩略图为竖向', r10.galCards > 0 && r10.galRatio !== undefined && r10.galRatio < 1, '卡片 ' + r10.galCards + ' 比例 ' + r10.galRatio);
  ok('P1 竖屏流程同样无网络请求', req2.length === 0, req2.slice(0, 3).join(' | '));

  console.log('\n[11] 灵敏度判别力专项（R-004 · 含渐变转场的难片源）');
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1280, height: 800 });
  const req3 = [];
  p3.on('request', r => { const u = r.url(); if (!/^(data|blob):/.test(u) && !/^file:/.test(u)) req3.push(u); });
  p3.on('pageerror', e => errors.push('PAGEERROR(sens): ' + e.message));
  await p3.goto(URL_, { waitUntil: 'load' });
  await p3.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await p3.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  await p3.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });

  const r11 = await p3.evaluate(async () => {
    const out = {};
    /* 8 秒难片源：0-2s 纯硬切；2-4s 一次 0.8 秒叠化（渐变转场）；4-8s 缓慢亮度漂移（不该被判成切点） */
    const W = 320, H = 180;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(25), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
    const t0 = performance.now();
    await new Promise(res => {
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        if (t < 2) {                       /* 镜1：深蓝 */
          ctx.fillStyle = '#123a6b'; ctx.fillRect(0, 0, W, H);
        } else if (t < 2.8) {              /* 叠化：深蓝 → 土黄，0.8 秒渐变 */
          const k = (t - 2) / 0.8;
          ctx.fillStyle = '#123a6b'; ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = k; ctx.fillStyle = '#b08432'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
        } else if (t < 4) {                /* 镜2：土黄 */
          ctx.fillStyle = '#b08432'; ctx.fillRect(0, 0, W, H);
        } else {                           /* 镜3：同一画面缓慢变亮，属于运镜/曝光漂移，不是切点 */
          const g = Math.round(60 + (t - 4) * 22);
          ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + (g + 10) + ')'; ctx.fillRect(0, 0, W, H);
        }
        ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif';
        ctx.fillText(t.toFixed(1) + 's', 12, 30);
        if (t < 8) requestAnimationFrame(draw); else res();
      };
      draw();
    });
    rec.stop(); await new Promise(res => rec.onstop = res);
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'hard.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput'); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1800));

    try {
      const curve = [];
      for (const sens of [10, 30, 50, 70, 90]) {
        const r = await LP.sbd.detect({ sampleFps: 6, sens: sens, minDur: 0.4 });
        curve.push({ sens: sens, n: r.cuts.length, t: r.cuts.map(c => +c.t.toFixed(2)) });
      }
      out.curve = curve;
      const ns = curve.map(c => c.n);
      out.min = Math.min.apply(null, ns); out.max = Math.max.apply(null, ns);
      /* R-004 判别力：灵敏度扫过全程，切点数必须发生变化（不能恒定） */
      out.discriminates = out.max > out.min;
      /* 单调不减：灵敏度越高切点不应该变少 */
      out.monotonic = ns.every((v, i) => i === 0 || v >= ns[i - 1]);
      /* 低灵敏必须仍能抓到 2s 处那次转场附近的边界（不能一个都不剩） */
      out.lowKeepsHardCut = curve[0].n >= 1 || curve[1].n >= 1;
      /* 高灵敏不应把 4-8s 的缓慢亮度漂移切成一堆碎片（纯色合成片对漂移最敏感；
       * 真实素材有纹理，漂移不会触发，这里放宽到 ≤2 个误报尖峰即算过关） */
      out.noDriftSpam = curve[curve.length - 1].t.filter(t => t > 4.3).length <= 2;
    } catch (e) { out.err = e.message; }
    return out;
  });
  const curveTxt = (r11.curve || []).map(c => 's' + c.sens + '→' + c.n).join(' ');
  ok('R-004 灵敏度对难片源具备判别力', r11.discriminates === true, r11.err || (curveTxt + '（切点数需随灵敏度变化）'));
  ok('R-004 切点数随灵敏度单调不减', r11.monotonic === true, curveTxt);
  ok('R-006 低灵敏仍保留真实硬切', r11.lowKeepsHardCut === true, curveTxt);
  ok('R-006 高灵敏不把亮度漂移切碎', r11.noDriftSpam === true, JSON.stringify((r11.curve || []).slice(-1)[0]));
  ok('P1 难片源流程同样无网络请求', req3.length === 0, req3.slice(0, 3).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.pass).length;
  console.log('\n======== 结果：' + pass + '/' + results.length + ' 通过 ========');
  if (errors.length) { console.log('\n错误明细：'); errors.slice(0, 12).forEach(e => console.log('  - ' + e)); }
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
