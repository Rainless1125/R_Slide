// 逐格渲染 showreel.html → MP4（1920×1080 / 60fps）
//   node render.js                      完整輸出 r_slide_showreel_v2.mp4
//   node render.js --stills 3,7.5,14    只輸出指定秒數的截圖（檢查畫面用）
// 需要：playwright（含 Chromium）、ffmpeg
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'r_slide_showreel_v2.mp4');
const WORKERS = Math.max(1, Math.min(4, os.cpus().length));
const args = process.argv.slice(2);
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;
const outDirArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'stills');

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(ROOT, 'showreel.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}

async function renderSegment(browser, from, to, file, fps) {
  const page = await openPage(browser);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = from; f < to; f++) {
    await page.evaluate(t => window.render(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - from) % 120 === 0) console.log(`  [${path.basename(file)}] frame ${f}/${to}`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  if (stillsArg) {
    fs.mkdirSync(outDirArg, { recursive: true });
    const page = await openPage(browser);
    for (const s of stillsArg.split(',').map(Number)) {
      await page.evaluate(t => window.render(t), s);
      await page.screenshot({ path: path.join(outDirArg, `t_${s.toFixed(2)}.jpg`), type: 'jpeg', quality: 90 });
    }
    await browser.close();
    return;
  }
  const probe = await openPage(browser);
  const { FPS, DURATION } = await probe.evaluate(() => window.SHOWREEL);
  await probe.close();
  const total = Math.round(FPS * DURATION);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'showreel-'));
  const per = Math.ceil(total / WORKERS);
  const segs = [];
  const jobs = [];
  for (let w = 0; w < WORKERS; w++) {
    const from = w * per, to = Math.min(total, from + per);
    if (from >= to) break;
    const file = path.join(tmp, `seg${w}.mp4`);
    segs.push(file);
    jobs.push(renderSegment(browser, from, to, file, FPS));
  }
  console.log(`Rendering ${total} frames with ${jobs.length} workers…`);
  await Promise.all(jobs);
  await browser.close();
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Done →', OUT);
})().catch(e => { console.error(e); process.exit(1); });
