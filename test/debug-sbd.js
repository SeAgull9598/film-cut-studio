/* 定向调试：SBD 抽帧与阈值内部数据 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const URL_ = 'file://' + path.join(__dirname, '..', 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => { const m = document.querySelector('#modalRoot .mask'); if (m) m.remove(); });

  const out = await page.evaluate(async () => {
    /* 造 6 秒 4 镜测试片 */
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
    const ctx = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(25), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
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
    rec.stop(); await new Promise(res => rec.onstop = res);
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'dbg.webm', { type: 'video/webm' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#fileInput'); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1500));

    const r = {};
    r.dur = document.querySelector('#video').duration;
    r.api = Object.keys(LP.sbd);
    r.steps = [];
    /* 复现冒烟测试 [3][4] 的前置操作 */
    r.steps.push(['clean', (await LP.sbd.detect({sampleFps:3})).cuts.length]);

    LP.player.seek(0); LP.player.setIn(0); LP.player.setOut(2); LP.edit.addShotFromIO();
    LP.player.setIn(2); LP.player.setOut(4); LP.edit.addShotFromIO();
    r.steps.push(['afterShots+IO', (await LP.sbd.detect({sampleFps:3})).cuts.length]);

    const s0 = LP.state.shots()[0];
    LP.edit.splitAt(s0, 1);
    r.steps.push(['afterSplit', (await LP.sbd.detect({sampleFps:3})).cuts.length]);

    LP.player.loop = false;
    LP.player.playRange(s0.in, s0.out, { shotId: s0.id });
    await new Promise(x => setTimeout(x, 1400));
    r.steps.push(['afterPlayRange', (await LP.sbd.detect({sampleFps:3})).cuts.length]);

    r.io = LP.player.getIO ? LP.player.getIO() : null;
    r.vt = document.querySelector('#video').currentTime;
    r.vpaused = document.querySelector('#video').paused;
    return r;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
