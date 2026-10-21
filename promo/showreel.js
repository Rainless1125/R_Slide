/* R Slide showreel v2：所有畫面都是時間 t（秒）的純函式，render(t) 可任意跳格，供 render.js 逐格截圖 */
const FPS = 60, DURATION = 30;
const $ = id => document.getElementById(id);

/* ---------- 小工具 ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const eo = k => 1 - Math.pow(1 - k, 3);
const eio = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const eback = k => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const pad = (n, w = 2) => String(n).padStart(w, '0');

function tf(el, o = {}) {
  const { x = 0, y = 0, s = 1, sx, r = 0, op = 1, b = 0 } = o;
  el.style.opacity = op;
  el.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx !== undefined ? `${sx}, 1` : s})`;
  el.style.filter = b > 0.05 ? `blur(${b}px)` : '';
}
// 依關鍵影格 [[t, x, y], ...] 內插位置
function track(t, keys) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1] = keys[i];
    if (t <= t1) {
      const [t0, x0, y0] = keys[i - 1];
      const k = eio(prog(t, t0, t1));
      return [lerp(x0, x1, k), lerp(y0, y1, k)];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
}
const typed = (str, k) => { const a = Array.from(str); return a.slice(0, Math.round(a.length * clamp(k))).join(''); };
function center(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/* ---------- 投影片樣板 ---------- */
const GATES = `
  <div class="tag">02 / 申請重點</div>
  <div class="h">三道門檻，缺一不可。</div>
  <div class="sub">題目可依興趣出發，但資格要先查清楚。</div>
  <div class="cards">
    <div class="c"><i class="fa-solid fa-brain"></i><b>AI 相關</b><p>研究主題需定位在 AI 領域。</p></div>
    <div class="c"><i class="fa-regular fa-calendar"></i><b>近 3 年內</b><p>限近三年內發表的 SCI 期刊。</p></div>
    <div class="c"><i class="fa-solid fa-shield-halved"></i><b>非掠奪性期刊</b><p>需為通過認證的正規期刊。</p></div>
  </div>`;

/* ---------- 場景表 ---------- */
const SCENES = [
  { id: 'intro', a: 0.0, d: 2.4 },
  { id: 's1', a: 2.4, d: 3.4, ch: '01 / 08 — INPUT' },
  { id: 's2', a: 5.8, d: 3.2, ch: '02 / 08 — LAYOUT' },
  { id: 's3', a: 9.0, d: 3.4, ch: '03 / 08 — CHARTS' },
  { id: 's4', a: 12.4, d: 3.8, ch: '04 / 08 — EDITING' },
  { id: 's5', a: 16.2, d: 3.0, ch: '05 / 08 — STYLES' },
  { id: 's6', a: 19.2, d: 3.2, ch: '06 / 08 — REGENERATE' },
  { id: 's7', a: 22.4, d: 3.0, ch: '07 / 08 — PRESENTER' },
  { id: 's8', a: 25.4, d: 2.5, ch: '08 / 08 — EXPORT' },
  { id: 'outro', a: 27.9, d: 2.1, last: true }
];

const UPD = {};      // 各場景的 update(lt, d)
const G = {};        // init 時量測的座標
let cursorState = null; // 本格游標 { x, y, op, clicks: [t...], lt }

/* ---------- 初始化 ---------- */
function splitChars(el) {
  const walk = node => {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        Array.from(n.textContent).forEach(c => {
          const s = document.createElement('span');
          s.className = 'ch'; s.textContent = c; frag.appendChild(s);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
}
function paintHighlights() {
  document.querySelectorAll('.hl').forEach(hl => {
    const hr = hl.getBoundingClientRect();
    hl.querySelectorAll('.ch').forEach(c => {
      const cr = c.getBoundingClientRect();
      c.style.backgroundImage = 'linear-gradient(90deg, #3b82f6, #a855f7 55%, #ec4899)';
      c.style.backgroundSize = `${hr.width}px ${hr.height}px`;
      c.style.backgroundPosition = `${hr.left - cr.left}px 0`;
      c.style.backgroundRepeat = 'no-repeat';
    });
  });
}

function init() {
  document.querySelectorAll('.ttl, .wordmark').forEach(splitChars);
  $('styleSlide').innerHTML = GATES;
  $('regenOld').innerHTML = GATES;

  // 講者檢視的縮圖：沿用其他場景的投影片
  const mk = (src, cls, scale) => {
    const s = document.createElement('div');
    s.className = 'slide ' + cls; s.innerHTML = src;
    s.style.transform = `scale(${scale})`;
    return s;
  };
  const kpiHTML = $('regenNew').innerHTML;
  G.pvA = mk(GATES, 'gates th-white', .8);
  G.pvB = mk(kpiHTML, 'kpi-dark', .8);
  $('pvCur').append(G.pvA, G.pvB);
  G.pvNA = mk(kpiHTML, 'kpi-dark', .52);
  G.pvNB = mk($('chartSlide').innerHTML.replace(/id="[^"]*"/g, ''), 'chart-slide', .52);
  $('pvNext').append(G.pvNA, G.pvNB);
  G.pvNB.querySelectorAll('.bar').forEach((b, i) => { b.style.height = [32, 45, 58, 92][i] * 3 + 'px'; });
  G.pvNB.querySelector('.bar:last-child em').textContent = '92';
  G.pvB.querySelector('.tag').textContent = G.pvNA.querySelector('.tag').textContent = '03 / 成果';
  G.pvNB.querySelector('.tag').textContent = '04 / 營運成果';

  // 圖示清單
  const icons = ['chart-line', 'users', 'sack-dollar', 'lightbulb', 'bullseye', 'handshake', 'calendar-check',
    'gears', 'rocket', 'comments', 'file-contract', 'shield-halved', 'clock', 'globe',
    'chart-pie', 'trophy', 'leaf', 'heart-pulse', 'graduation-cap', 'location-dot', 'arrow-trend-up'];
  $('pkGrid').innerHTML = icons.map(n => `<span><i class="fa-solid fa-${n}"></i></span>`).join('');
  G.pkCells = [...$('pkGrid').children];

  // 量測（此時沒有任何 transform）
  G.btnIcon = center($('btnIcon'));
  G.btnShape = center($('btnShape'));
  G.btnRegen = center($('btnRegen'));
  G.mdBtn = center($('mdBtn'));
  G.rocket = center(G.pkCells[8]);
  G.swBlue = null; // 跟著格式列移動，於場景中計算

  const wm = $('outWord').getBoundingClientRect().width;
  const gx = 960 - (170 + 64 + wm) / 2;
  G.outLogo = [gx, 360]; G.outWord = [gx + 170 + 64, 362];
  const iw = $('introWord').getBoundingClientRect().width;
  const ix = 960 - (170 + 64 + iw) / 2;
  G.introLogoEnd = ix; G.introWord = [ix + 170 + 64, 456];

  paintHighlights();
}

/* ---------- 共用動畫 ---------- */
function chapterIn(sc, lt) {
  const label = sc.querySelector('.label');
  if (label) { const k = eo(prog(lt, 0.05, 0.45)); tf(label, { x: lerp(-30, 0, k), op: k }); }
  const chars = sc.querySelectorAll('.ttl .ch');
  chars.forEach((c, i) => {
    const k = eo(prog(lt, 0.1 + i * 0.022, 0.5 + i * 0.022));
    tf(c, { y: lerp(46, 0, k), op: k, b: (1 - k) * 10 });
  });
  const sub = sc.querySelector(':scope > .sub');
  if (sub) { const k = eo(prog(lt, 0.35, 0.75)); tf(sub, { y: lerp(16, 0, k), op: k }); }
}
function fadeUp(el, lt, a, dur = 0.4, dy = 30) {
  const k = eo(prog(lt, a, a + dur));
  tf(el, { y: lerp(dy, 0, k), op: k });
  return k;
}
function pop(el, lt, a, dur = 0.35, from = 0.4) {
  const k = prog(lt, a, a + dur);
  tf(el, { s: lerp(from, 1, eback(k)), op: clamp(k * 2.5) });
  return k;
}

/* ---------- INTRO ---------- */
UPD.intro = (lt) => {
  const sk = eo(prog(lt, 0, 0.6));
  const sOp = 1 - prog(lt, 0.55, 0.85);
  tf($('streakL'), { x: lerp(-760, 200, sk), op: sOp });
  tf($('streakR'), { x: lerp(760, -200, sk), op: sOp });

  const lk = prog(lt, 0.42, 0.9);
  const mk = eio(prog(lt, 1.15, 1.6));
  tf($('introLogo'), { x: lerp(0, G.introLogoEnd - 875, mk), s: lerp(0.3, 1, eback(lk)), op: clamp(lk * 3) });

  [['ring1', 0.5], ['ring2', 0.6]].forEach(([id, a]) => {
    const k = prog(lt, a, a + 0.7);
    const el = $(id);
    el.style.opacity = k > 0 ? (1 - k) * 0.9 : 0;
    el.style.transform = `translate(-50%, -50%) scale(${lerp(0.5, 1.7, eo(k))})`;
  });

  $('flash').style.opacity = prog(lt, 0.72, 0.82) * (1 - prog(lt, 0.85, 1.35)) * 0.8;

  const word = $('introWord');
  word.style.left = G.introWord[0] + 'px';
  word.querySelectorAll('.ch').forEach((c, i) => {
    const k = eo(prog(lt, 1.3 + i * 0.045, 1.65 + i * 0.045));
    tf(c, { x: lerp(-40, 0, k), op: k, b: (1 - k) * 12 });
  });
  const tk = eo(prog(lt, 1.65, 2.05));
  const tag = $('introTag');
  tag.style.opacity = tk * 0.9;
  tag.style.letterSpacing = lerp(0.9, 0.5, tk) + 'em';
};

/* ---------- 01 INPUT ---------- */
UPD.s1 = (lt) => {
  const sc = $('s1');
  chapterIn(sc, lt);
  const dk = eo(prog(lt, 0.15, 0.5));
  tf($('drop'), { s: lerp(0.95, 1, dk), op: dk });
  $('dropHint').style.opacity = dk * (1 - prog(lt, 0.85, 1.05));

  const FX = [117, 282, 447, 612], FR = [-8, -3, 3, 8];
  for (let i = 0; i < 4; i++) {
    const el = $('fc' + i);
    el.style.left = FX[i] + 'px'; el.style.top = (88 + (i % 2) * 12) + 'px';
    const k = prog(lt, 0.3 + i * 0.13, 0.8 + i * 0.13);
    const e = eback(k);
    const sk = eio(prog(lt, 1.3 + i * 0.04, 1.62 + i * 0.04));   // 被吸入輸入框
    tf(el, {
      x: lerp(560 - i * 60, 0, e) + lerp(0, 440 - 75 - FX[i], sk),
      y: lerp(-360, 0, e) + lerp(0, 20, sk),
      r: lerp(28, FR[i], e) * (1 - sk),
      s: lerp(1, 0.25, sk),
      op: clamp(k * 3) * (1 - sk)
    });
  }
  $('ta').querySelectorAll('i').forEach((l, i) => {
    const k = eo(prog(lt, 1.55 + i * 0.05, 1.9 + i * 0.05));
    l.style.opacity = k; l.style.transform = `scaleX(${k})`;
  });
  const ck = eo(prog(lt, 1.6, 2.3));
  $('taCount').textContent = Math.round(12840 * ck).toLocaleString('en-US') + ' 字';
  $('taCount').style.opacity = prog(lt, 1.55, 1.7);

  fadeUp($('mode0'), lt, 1.85);
  fadeUp($('mode1'), lt, 1.95);
  const rk = eio(prog(lt, 2.55, 2.85));
  const ring = $('modeRing');
  ring.style.left = (-3 + 450 * rk) + 'px';
  ring.style.opacity = prog(lt, 2.1, 2.3);
  $('mode0').style.borderColor = 'rgba(255,255,255,.1)';
  fadeUp($('pages'), lt, 2.2, 0.4, 20);
};

/* ---------- 02 LAYOUT ---------- */
const LAYS = [
  { at: 0.55, el: 'layKpi', src: 0, label: 'KPI 大數字' },
  { at: 1.4, el: 'layFlow', src: 1, label: '流程步驟卡' },
  { at: 2.25, el: 'layCmp', src: 2, label: '左右對比' }
];
UPD.s2 = (lt) => {
  const sc = $('s2');
  chapterIn(sc, lt);
  [0, 1, 2].forEach(i => fadeUp($('src' + i), lt, 0.2 + i * 0.1, 0.4, 20));
  const ck = eo(prog(lt, 0.25, 0.6));
  tf($('lay'), { y: lerp(40, 0, ck), op: ck });

  let cur = -1;
  LAYS.forEach((L, i) => { if (lt >= L.at) cur = i; });
  LAYS.forEach((L, i) => {
    const el = $(L.el);
    const kIn = eo(prog(lt, L.at, L.at + 0.3));
    const next = LAYS[i + 1];
    const kOut = next ? prog(lt, next.at - 0.05, next.at + 0.15) : 0;
    tf(el, { y: lerp(26, 0, kIn) - kOut * 16, op: kIn * (1 - kOut) });
    // 各版型內的小動畫
    if (L.el === 'layKpi') el.querySelector('.kpi-big b').textContent = Math.round(85 * eo(prog(lt, L.at, L.at + 0.6))) + '%';
    if (L.el === 'layFlow') el.querySelectorAll('.step').forEach((s, j) => {
      const k = eo(prog(lt, L.at + j * 0.08, L.at + 0.3 + j * 0.08)); tf(s, { y: lerp(30, 0, k), op: k });
    });
  });
  [0, 1, 2].forEach(i => $('src' + i).classList.toggle('on', cur >= 0 && LAYS[cur].src === i));
  // AI 中間的連線
  const wire = $('wirePath');
  if (cur >= 0) {
    const sy = [450, 596, 742][LAYS[cur].src];
    wire.setAttribute('d', `M 582 ${sy} C 680 ${sy}, 660 621, 758 621`);
    wire.style.strokeDashoffset = -lt * 70;
    wire.parentNode.style.opacity = eo(prog(lt, LAYS[cur].at, LAYS[cur].at + 0.25));
  } else wire.parentNode.style.opacity = 0;
  const lab = $('layLabel');
  lab.innerHTML = `LAYOUT <b>${cur >= 0 ? LAYS[cur].label : ''}</b>`;
  lab.style.opacity = cur >= 0 ? prog(lt, LAYS[cur].at, LAYS[cur].at + 0.2) : 0;
};

/* ---------- 03 CHARTS ---------- */
UPD.s3 = (lt) => {
  const sc = $('s3');
  chapterIn(sc, lt);
  const ck = eo(prog(lt, 0.2, 0.55));
  tf($('chartSlide'), { y: lerp(40, 0, ck), op: ck });
  const q4 = lerp(74, 92, eback(prog(lt, 1.95, 2.4)));
  const vals = [32, 45, 58, q4];
  vals.forEach((v, i) => {
    const k = eo(prog(lt, 0.45 + i * 0.09, 1.0 + i * 0.09));
    const b = $('bar' + i);
    b.style.height = (v * 3 * k) + 'px';
    b.querySelector('em').textContent = Math.round(v * k);
    b.querySelector('em').style.opacity = prog(lt, 0.7 + i * 0.09, 0.9 + i * 0.09);
  });
  const rk = eo(prog(lt, 1.0, 1.35));
  const refl = $('refl');
  refl.style.opacity = rk; refl.style.transform = `scaleX(${rk})`; refl.style.transformOrigin = 'left';

  const sk = eo(prog(lt, 0.8, 1.2));
  tf($('sheet'), { x: lerp(60, 0, sk), op: sk });
  const cell = $('cellQ4');
  cell.classList.toggle('on', lt > 1.45);
  cell.textContent = lt < 1.62 ? '74' : lt < 1.72 ? '' : lt < 1.84 ? '9' : '92';
  fadeUp($('ctypes'), lt, 0.9, 0.4, 16);
};

/* ---------- 04 EDIT ---------- */
UPD.s4 = (lt) => {
  const sc = $('s4');
  chapterIn(sc, lt);
  fadeUp($('tools'), lt, 0.2, 0.4, 20);
  const ek = eo(prog(lt, 0.25, 0.6));
  tf($('editSlide'), { y: lerp(40, 0, ek), op: ek });
  fadeUp($('editKeys'), lt, 0.6, 0.4, 14);

  $('btnIcon').classList.toggle('on', lt > 0.8 && lt < 1.45);
  $('btnShape').classList.toggle('on', lt > 1.9 && lt < 2.3);

  // 圖示清單
  const po = eo(prog(lt, 0.85, 1.05)) * (1 - prog(lt, 1.42, 1.56));
  tf($('picker'), { s: lerp(0.92, 1, po), y: lerp(-10, 0, po), op: po });
  G.pkCells.forEach((c, i) => c.classList.toggle('on', i === 8 && lt > 1.18));
  pop($('badge'), lt, 1.45, 0.4, 0);

  // 星形：出現 → 拖曳到中心並吸附 → 換色
  const SX = 560, SY = 330, TX = 868 - 85, TY = 280 - 85;
  const dk = eio(prog(lt, 2.3, 2.95));
  const sx = lerp(SX, TX, dk), sy = lerp(SY, TY, dk);
  const shape = $('shape');
  shape.style.left = sx + 'px'; shape.style.top = sy + 'px';
  pop(shape, lt, 1.95, 0.35, 0.2);
  shape.querySelector('.sel').style.opacity = lt > 1.95 ? 1 : 0;
  const gk = prog(dk, 0.8, 0.95) * (1 - prog(lt, 3.05, 3.2));
  $('guideV').style.opacity = gk; $('guideH').style.opacity = gk;
  $('starPath').setAttribute('fill', lt > 3.42 ? 'url(#sg2)' : 'url(#sg)');

  const fmt = $('fmt');
  fmt.style.left = (TX - 40) + 'px'; fmt.style.top = (TY + 194) + 'px';
  const fk = eo(prog(lt, 3.05, 3.25));
  tf(fmt, { y: lerp(-10, 0, fk), op: fk });
  $('swBlue').classList.toggle('on', lt > 3.42);

  // 游標（星形中心的舞台座標）
  const slideX = 560, slideY = 380;
  const sc0 = [slideX + SX + 85, slideY + SY + 85];
  const sc1 = [slideX + TX + 85, slideY + TY + 85];
  const sw = [slideX + TX - 40 + 14 + 26 + 10 + 13, slideY + TY + 194 + 25];
  const keys = [[0.35, 1250, 860], [0.75, ...G.btnIcon], [1.3, ...G.rocket], [1.8, ...G.btnShape], [2.25, ...sc0]];
  const [cx, cy] = lt < 2.3 ? track(lt, keys) : lt < 2.95 ? [lerp(sc0[0], sc1[0], dk), lerp(sc0[1], sc1[1], dk)] : track(lt, [[2.95, ...sc1], [3.35, ...sw]]);
  cursorState = { x: cx, y: cy, op: prog(lt, 0.3, 0.45) * (1 - prog(lt, 3.5, 3.65)), clicks: [0.8, 1.35, 1.9, 2.3, 3.4], lt, hold: lt > 2.3 && lt < 2.95 };
};

/* ---------- 05 STYLES ---------- */
const STY = [[0, 'th-white', 0], [0.8, 'th-dark', 1], [1.3, 'th-navy', 2], [1.8, 'th-brutal', 5], [2.3, 'th-gold', 7]];
UPD.s5 = (lt) => {
  const sc = $('s5');
  chapterIn(sc, lt);
  const items = $('styles').querySelectorAll('li');
  items.forEach((li, i) => fadeUp(li, lt, 0.2 + i * 0.025, 0.35, 14));
  const sk = eo(prog(lt, 0.25, 0.6));
  let cur = 0;
  STY.forEach((s, i) => { if (lt >= s[0]) cur = i; });
  const slide = $('styleSlide');
  slide.className = 'slide gates ' + STY[cur][1];
  const since = lt - STY[cur][0];
  const pulse = cur > 0 ? 1 - eo(prog(since, 0, 0.3)) : 0;
  tf(slide, { y: lerp(40, 0, sk), s: 1 - pulse * 0.02, op: sk });
  const sw = $('sweep');
  sw.style.opacity = cur > 0 ? (1 - prog(since, 0.1, 0.4)) * 0.9 : 0;
  sw.style.backgroundPosition = `${lerp(100, 0, prog(since, 0, 0.4))}% 0`;
  // 清單上的選取框
  const prevIdx = cur > 0 ? STY[cur - 1][2] : 0;
  const hy = lerp(prevIdx, STY[cur][2], eio(prog(since, 0, 0.22))) * 52;
  const hl = $('styHl');
  hl.style.transform = `translateY(${hy}px)`;
  hl.style.opacity = prog(lt, 0.4, 0.6);
  items.forEach((li, i) => li.classList.toggle('on', i === STY[cur][2]));
};

/* ---------- 06 REGENERATE ---------- */
const REGEN_TXT = '改成 KPI 大數字，強調第三季 85% 的成長';
UPD.s6 = (lt) => {
  const sc = $('s6');
  chapterIn(sc, lt);
  const ck = eo(prog(lt, 0.2, 0.55));
  tf(sc.querySelector('.regen-wrap'), { y: lerp(40, 0, ck), op: ck });
  const pk = eo(prog(lt, 0.3, 0.65));
  const pbar = $('pbar');
  pbar.style.opacity = pk; pbar.style.transform = `translateX(-50%) translateY(${lerp(16, 0, pk)}px)`;
  $('btnRegen').classList.toggle('on', lt > 0.85 && lt < 2.2);

  const mo = eo(prog(lt, 0.95, 1.15)) * (1 - prog(lt, 2.15, 2.3));
  tf($('modal'), { y: lerp(24, 0, mo), s: lerp(0.97, 1, mo), op: mo });
  $('mdTxt').textContent = typed(REGEN_TXT, prog(lt, 1.12, 1.85));
  $('modal').querySelector('.caret').style.opacity = (Math.floor(lt * 4) % 2 === 0 || lt < 1.9) ? 1 : 0;
  $('mdBtn').style.filter = lt > 2.08 && lt < 2.2 ? 'brightness(1.25)' : '';

  const sk = eio(prog(lt, 2.3, 2.85));
  const nw = $('regenNew');
  nw.style.clipPath = `inset(0 0 ${(1 - sk) * 100}% 0 round 20px)`;
  nw.style.opacity = lt > 2.3 ? 1 : 0;
  const scan = $('scan');
  scan.style.top = (sk * 562 - 3) + 'px';
  scan.style.opacity = lt > 2.3 && lt < 2.95 ? 1 - prog(lt, 2.8, 2.95) : 0;
  const toast = $('toast');
  const tk = eo(prog(lt, 2.7, 2.95));
  toast.style.opacity = tk; toast.style.transform = `translateX(-50%) translateY(${lerp(16, 0, tk)}px)`;

  const keys = [[0.4, 1480, 760], [0.8, ...G.btnRegen], [1.5, 1560, 640], [2.05, ...G.mdBtn]];
  const [cx, cy] = track(lt, keys);
  cursorState = { x: cx, y: cy, op: prog(lt, 0.35, 0.5) * (1 - prog(lt, 2.2, 2.4)), clicks: [0.85, 2.1], lt };
};

/* ---------- 07 PRESENTER ---------- */
const NOTE1 = '先點出三道門檻的共同點：缺任何一項都無法送件，再舉去年的退件案例。';
const NOTE2 = '第三季營收年增 85%，主要來自新客戶；毛利也同步提升到 42%。';
UPD.s7 = (lt) => {
  const sc = $('s7');
  chapterIn(sc, lt);
  const wk = eo(prog(lt, 0.15, 0.6));
  tf($('pv'), { y: lerp(60, 0, wk), s: lerp(0.97, 1, wk), op: wk });
  fadeUp($('pvKeys'), lt, 0.6, 0.4, 14);
  const sec = 72 + Math.floor(lt);
  $('pvTimer').innerHTML = `<i class="fa-regular fa-clock"></i>${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  const SW = 1.75;
  const xk = eio(prog(lt, SW, SW + 0.3));
  G.pvA.style.opacity = 1 - xk; G.pvB.style.opacity = xk;
  G.pvB.style.transform = `translateX(${lerp(60, 0, xk)}px) scale(.8)`;
  G.pvNA.style.opacity = 1 - xk; G.pvNB.style.opacity = xk;
  $('pvNo').textContent = lt < SW + 0.15 ? '2 / 8' : '3 / 8';
  const note = $('pvNote');
  note.textContent = lt < SW ? typed(NOTE1, prog(lt, 0.55, 1.6)) : typed(NOTE2, prog(lt, SW + 0.15, SW + 1.0));
};

/* ---------- 08 EXPORT ---------- */
UPD.s8 = (lt) => {
  const sc = $('s8');
  chapterIn(sc, lt);
  [0, 1, 2].forEach(i => {
    const card = $('exp' + i);
    fadeUp(card, lt, 0.15 + i * 0.08, 0.45, 40);
    const fl = $('fly' + i);
    const k = eio(prog(lt, 0.45 + i * 0.1, 0.95 + i * 0.1));
    const tx = [420, 790, 1160][i] + 170 - 100, ty = 560;
    fl.style.left = '860px'; fl.style.top = '330px';
    tf(fl, { x: lerp(-60 + i * 60, tx - 860, k), y: lerp(-i * 8, ty - 330, k), r: lerp((i - 1) * 6, 0, k), s: lerp(1, 0.35, k),
      op: prog(lt, 0.35 + i * 0.1, 0.5 + i * 0.1) * (1 - prog(k, 0.8, 1)) });
    const bk = eio(prog(lt, 0.9 + i * 0.12, 1.5 + i * 0.12));
    card.querySelector('.eb i').style.width = bk * 100 + '%';
    pop(card.querySelector('.ok'), lt, 1.45 + i * 0.12, 0.3, 0.2);
  });
};

/* ---------- OUTRO ---------- */
UPD.outro = (lt) => {
  const logo = $('outLogo');
  logo.style.left = G.outLogo[0] + 'px'; logo.style.top = G.outLogo[1] + 'px';
  pop(logo, lt, 0.05, 0.45, 0.4);
  const word = $('outWord');
  word.style.left = G.outWord[0] + 'px'; word.style.top = G.outWord[1] + 'px';
  word.querySelectorAll('.ch').forEach((c, i) => {
    const k = eo(prog(lt, 0.15 + i * 0.04, 0.5 + i * 0.04));
    tf(c, { x: lerp(-30, 0, k), op: k, b: (1 - k) * 10 });
  });
  const lk = eio(prog(lt, 0.45, 0.85));
  const line = $('outLine');
  line.style.transform = `scaleX(${lk})`; line.style.opacity = lk;
  fadeUp($('outTag'), lt, 0.6, 0.4, 20);
  fadeUp($('outUrl'), lt, 0.9, 0.4, 10);
};

/* ---------- 主 render ---------- */
function render(t) {
  // 背景
  const bgk = 0.55 + 0.45 * prog(t, 0.7, 1.6);
  const A = $('blobA'), B = $('blobB'), C = $('blobC');
  A.style.transform = `translate(${-420 + 90 * Math.sin(t * 0.33)}px, ${-380 + 70 * Math.cos(t * 0.27)}px)`;
  B.style.transform = `translate(${760 + 110 * Math.cos(t * 0.25)}px, ${260 + 80 * Math.sin(t * 0.31)}px)`;
  C.style.transform = `translate(${520 + 160 * Math.sin(t * 0.21 + 1)}px, ${120 + 90 * Math.cos(t * 0.37)}px)`;
  A.style.opacity = B.style.opacity = C.style.opacity = bgk;

  // HUD
  const hk = prog(t, 2.3, 2.7) * (1 - prog(t, 27.7, 28.0));
  $('hud').style.opacity = hk;
  $('grid').style.opacity = 0.35 + 0.65 * hk;
  $('hudTime').textContent = `00:${pad(Math.floor(t))}.${pad(Math.floor((t % 1) * 100))}`;
  $('hudFill').style.width = (t / DURATION * 100) + '%';

  cursorState = null;
  SCENES.forEach(S => {
    const el = $(S.id);
    const lt = t - S.a;
    const pad0 = 0.02;
    if (lt < -pad0 || lt > S.d + pad0) { el.style.opacity = 0; el.style.visibility = 'hidden'; return; }
    el.style.visibility = 'visible';
    const ex = S.last ? 0 : eio(prog(lt, S.d - 0.32, S.d));
    el.style.opacity = 1 - ex;
    el.style.transform = ex > 0 ? `scale(${1 + ex * 0.05})` : '';
    el.style.filter = ex > 0.02 ? `blur(${ex * 14}px)` : '';
    if (S.ch) $('hudChapter').textContent = S.ch;
    UPD[S.id](clamp(lt, 0, S.d), S.d);
  });

  // 游標與點擊漣漪
  const cur = $('cursor'), rip = $('ripple');
  if (cursorState && cursorState.op > 0) {
    const { x, y, op, clicks, lt, hold } = cursorState;
    let press = hold ? 1 : 0, rk = -1;
    clicks.forEach(c => { if (lt >= c - 0.06 && lt < c + 0.08) press = 1; if (lt >= c && lt < c + 0.4) rk = prog(lt, c, c + 0.4); });
    cur.style.opacity = op;
    cur.style.transform = `translate(${x - 8}px, ${y - 4}px) scale(${press ? 0.86 : 1})`;
    if (rk >= 0) {
      rip.style.opacity = (1 - rk) * op;
      rip.style.transform = `translate(${x}px, ${y}px) scale(${lerp(0.3, 1.4, eo(rk))})`;
    } else rip.style.opacity = 0;
  } else { cur.style.opacity = 0; rip.style.opacity = 0; }
}

window.render = render;
window.SHOWREEL = { FPS, DURATION };
(async () => {
  await document.fonts.ready;
  init();
  render(0);
  await document.fonts.ready;
  // 先把每個場景跑一次，確保所有字形子集都已載入
  for (let t = 0; t < DURATION; t += 0.5) render(t);
  await document.fonts.ready;
  render(0);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
})();
