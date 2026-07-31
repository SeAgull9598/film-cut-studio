/* 真实界面截图：用于视觉验收（达芬奇三栏 / 多维表 / 报告 / 术语库 / 自动切分）
 * 运行：NODE_PATH=... node test/shots.js
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const URL_ = 'file://' + path.join(__dirname, '..', 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '..', 'shots');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));

  await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 700));

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  · ' + name + '.png');
  };

  console.log('截图中…');
  await shot('01-首次引导');
  await page.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });

  /* 造一段 9 秒 6 镜的测试片，模拟人物访谈的景别推进 */
  await page.evaluate(async () => {
    const W = 640, H = 360;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(25), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
    const sc = [
      { bg: '#1d2b3a', fg: '#8fb3d9', label: '全景 · 院子' },
      { bg: '#2b2318', fg: '#d9b25f', label: '中景 · 他坐下' },
      { bg: '#131a20', fg: '#7fa8a0', label: '近景 · 手' },
      { bg: '#2a1618', fg: '#d98f8f', label: '特写 · 眼睛' },
      { bg: '#101416', fg: '#9aa1ab', label: '空镜 · 窗' },
      { bg: '#1a2418', fg: '#a8c98a', label: '全景 · 离开' }
    ];
    const t0 = performance.now();
    await new Promise(res => {
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        const i = Math.min(sc.length - 1, Math.floor(t / 1.5));
        ctx.fillStyle = sc[i].bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = sc[i].fg;
        const r = 40 + i * 22;
        ctx.beginPath(); ctx.arc(W / 2, H / 2 + 20, r, 0, Math.PI * 2); ctx.fill();
        ctx.font = '26px sans-serif'; ctx.fillText(sc[i].label, 26, 44);
        if (t < 9) requestAnimationFrame(draw); else res();
      };
      draw();
    });
    rec.stop(); await new Promise(res => rec.onstop = res);
    const file = new File([new Blob(chunks, { type: 'video/webm' })], '访谈样片.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput'); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1800));
  });

  /* 自动切分并写入时间线 */
  await page.evaluate(async () => {
    const res = await LP.sbd.detect({ sampleFps: 6, sens: 70, minDur: 0.5 });
    LP.state.push();
    LP.state.project.shots = res.segments.map(s => LP.model.newShot(s.in, s.out));
    LP.state.project.meta.title = '退伍军人访谈 · 参考片拆解';
    LP.state.commit('自动切分');
    LP.bus.emit('shots:changed');
    /* 填一些真实感的标注，让界面不是空的 */
    const d = [
      { size: '全景', move: ['固定'], sizeNote: '开场定场，先给环境再给人', light: '自然光，冷调，清晨', sound: '同期声：院子里的鸡叫、远处车声', soundRel: '同步', cutType: '硬切', cut: '切在他推门那一下', sevenQ: '更远。先让观众站在院子外面看。' },
      { size: '中景', move: ['推'], sizeNote: '全→中，第一次逼近', moveWhy: '缓推，慢到几乎察觉不到，等他坐稳才到位', light: '侧光，半张脸在阴影里', sound: '环境声压低，人声进来', soundRel: '声先入', cutType: '硬切', sevenQ: '更近。镜头替观众坐到了他对面。' },
      { size: '近景', move: ['固定'], sizeNote: '中→近，继续收', blocking: '机位略低，人物在画右三分线，左侧留空', light: '暖调压低', sound: '只剩他的呼吸和衣料摩擦', soundRel: '留白', cutType: '硬切', sevenQ: '更近。空出来的左侧就是没回来的那个人。' },
      { size: '特写', move: ['固定'], sizeNote: '近→特，三级推进到位', light: '眼里有一点窗光', sound: '静默两秒', soundRel: '留白', cutType: '硬切', cut: '切在他抬眼之前半秒', sevenQ: '最近。他没说的话全在这两秒里。' },
      { size: '全景', move: ['固定'], sizeNote: '特→全，抽离', blocking: '空镜，窗，没有人', light: '逆光', sound: '风声接上一镜的静默', soundRel: '声延续', cutType: '叠化', sevenQ: '更远。给刚才那口气一个落地的地方。' },
      { size: '远景', move: ['拉'], sizeNote: '收尾拉开', moveWhy: '拉=抽离旁观，把他还给环境', light: '天光', sound: '同期声回来', soundRel: '同步', cutType: '硬切', sevenQ: '更远。观众被请出去，故事留在院子里。' }
    ];
    LP.state.shots().forEach((s, i) => { if (d[i]) Object.assign(s, d[i]); });
    LP.state.commit('示例标注');
    LP.bus.emit('shots:changed');
    LP.state.select([LP.state.shots()[3].id], null);
    LP.timeline.fit();
  });
  await new Promise(r => setTimeout(r, 700));
  await shot('02-拉片台-达芬奇三栏');

  /* 段落组 */
  await page.evaluate(() => {
    const ss = LP.state.shots();
    LP.state.select([ss[1].id, ss[2].id, ss[3].id], null);
    LP.edit.groupSelected();
    const g = LP.state.project.groups[0];
    if (g) { g.name = '三级推进段'; g.analysis = '全→中→近→特，四级逼近，声音同步收窄到静默，情绪在特写落地。'; }
    LP.state.commit('编组');
    LP.bus.emit('shots:changed');
  });
  await new Promise(r => setTimeout(r, 500));
  await shot('03-段落组与时间线');

  /* 多维表格四视图 */
  for (const v of ['grid', 'kanban', 'gallery', 'form']) {
    await page.evaluate(async (view) => {
      LP.ui.setPage('table');
      await new Promise(r => setTimeout(r, 120));
      LP.table.setView(view);
    }, v);
    await new Promise(r => setTimeout(r, 600));
    await shot('04-多维表-' + v);
  }

  /* 报告页 */
  await page.evaluate(() => LP.ui.setPage('report'));
  await new Promise(r => setTimeout(r, 800));
  await shot('05-报告与素材包');

  /* 术语库 */
  await page.evaluate(() => { LP.ui.setPage('cut'); LP.help.terms('推'); });
  await new Promise(r => setTimeout(r, 600));
  await shot('06-术语速查');
  await page.evaluate(() => document.querySelectorAll('.mask').forEach(m => m.remove()));

  /* 快捷键速查 */
  await page.evaluate(() => LP.help.shortcuts());
  await new Promise(r => setTimeout(r, 500));
  await shot('07-快捷键速查');
  await page.evaluate(() => document.querySelectorAll('.mask').forEach(m => m.remove()));

  /* 自动切分对话框 */
  await page.evaluate(() => LP.sbd.open());
  await new Promise(r => setTimeout(r, 2600));
  await shot('08-自动切分');
  await page.evaluate(() => document.querySelectorAll('.mask').forEach(m => m.remove()));

  /* 竖屏 9:16 */
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  await p2.goto(URL_, { waitUntil: 'load' });
  await p2.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await p2.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 700));
  await p2.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });
  await p2.evaluate(async () => {
    const W = 360, H = 640;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(25), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
    const cols = ['#1d2b3a', '#2b2318', '#131a20', '#2a1618'];
    const t0 = performance.now();
    await new Promise(res => {
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        const i = Math.min(3, Math.floor(t / 1.5));
        ctx.fillStyle = cols[i]; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#d9b25f'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 60 + i * 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('竖屏 9:16', 24, 46);
        if (t < 6) requestAnimationFrame(draw); else res();
      };
      draw();
    });
    rec.stop(); await new Promise(res => rec.onstop = res);
    const file = new File([new Blob(chunks, { type: 'video/webm' })], '竖屏样片.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput'); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1800));
    const res2 = await LP.sbd.detect({ sampleFps: 6, sens: 70, minDur: 0.5 });
    LP.state.push();
    LP.state.project.shots = res2.segments.map(s => LP.model.newShot(s.in, s.out));
    LP.state.project.meta.title = '竖屏样片 · 9:16';
    LP.state.commit('自动切分');
    LP.bus.emit('shots:changed');
    LP.state.select([LP.state.shots()[1].id], null);
    LP.timeline.fit();
  });
  await new Promise(r => setTimeout(r, 800));
  await p2.screenshot({ path: path.join(OUT, '09-竖屏9-16.png') });
  console.log('  · 09-竖屏9-16.png');

  await browser.close();
  console.log('完成，输出目录：' + OUT);
})().catch(e => { console.error(e); process.exit(2); });
