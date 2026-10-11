/* ===================== 匯出 HTML =====================
 * 在瀏覽器端把目前簡報組成單一 HTML 檔（CDN 版：Tailwind + Font Awesome）。
 *   sanitizeSlideHtml(html)       清理 AI 產生的內容（script / on* / javascript: / 外部資源白名單）
 *   buildExportHtml(title, slides) 輸出完整 HTML 字串
 *   exportPresentationHtml()      組裝並觸發下載
 * 圖表是 static/charts.js 預先畫好的靜態 inline SVG、上傳的圖片是 data:image/png|jpeg，
 * 兩者都不需要 script 或外部資源，因此這裡的白名單不必放行 Chart.js 等腳本。
 * 離線版（內嵌 Tailwind / FA / 字型）之後再補。
 */

/* 固定 CDN 版本（與 index.html 一致；升級時兩邊一起改） */
const EXPORT_CDN = {
    tailwind: 'https://cdn.tailwindcss.com/3.4.17',
    fontAwesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
};

/* 外部資源白名單：只允許這些網域（不含 CDN 以外的圖片 / 字型） */
const EXPORT_ALLOWED_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com'];

const EXPORT_PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<rect width="400" height="300" fill="#e4e4e7"/>' +
    '<path d="M120 200l50-60 40 45 30-35 40 50z" fill="#a1a1aa"/><circle cx="150" cy="110" r="18" fill="#a1a1aa"/></svg>'
);

/* 整段移除的標籤（含其內容） */
const EXPORT_DROP_TAGS = new Set([
    'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
    'link', 'meta', 'base', 'form', 'foreignobject', 'audio', 'video', 'source', 'track',
]);

/* 會載入資源的屬性 */
const EXPORT_URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'background', 'srcset']);

function _exportNormalizeUrl(v) {
    // 去掉空白與控制字元，擋 "java\tscript:" 這類混淆
    return String(v).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
}

function _exportIsAllowedUrl(v) {
    const u = _exportNormalizeUrl(v);
    if (/^https?:\/\//.test(u) || u.startsWith('//')) {
        try {
            return EXPORT_ALLOWED_HOSTS.includes(new URL(u.startsWith('//') ? 'https:' + u : u).hostname);
        } catch (_) { return false; }
    }
    return false;
}

/* 清理 CSS：移除 @import、@font-face、非白名單的 url() 以及 expression()/behavior */
function _exportSanitizeCss(css) {
    return String(css)
        .replace(/@import[^;]*;?/gi, '')
        .replace(/@font-face\s*\{[^}]*\}/gi, '')
        .replace(/expression\s*\([^)]*\)/gi, 'none')
        .replace(/behavior\s*:[^;}]*/gi, '')
        .replace(/-moz-binding\s*:[^;}]*/gi, '')
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, url) => {
            const u = _exportNormalizeUrl(url);
            if (u.startsWith('#')) return m;                       // 內部參照（SVG filter/gradient）
            if (u.startsWith('data:image/') && !u.startsWith('data:image/svg')) return m;
            if (_exportIsAllowedUrl(url)) return m;
            return 'none';
        });
}

function sanitizeSlideHtml(html) {
    // DOMParser 產生的文件是惰性的：不執行 script、不載入圖片
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${String(html ?? '')}</body></html>`, 'text/html');

    // 1. 移除危險標籤
    doc.body.querySelectorAll('*').forEach(el => {
        if (EXPORT_DROP_TAGS.has(el.tagName.toLowerCase())) el.remove();
    });

    // 2. 逐一處理屬性與 <style>
    doc.body.querySelectorAll('*').forEach(el => {
        const tag = el.tagName.toLowerCase();

        if (tag === 'style') {
            el.textContent = _exportSanitizeCss(el.textContent);
            return;
        }
        // SVG 動畫若改寫 href 可繞過檢查
        if ((tag === 'animate' || tag === 'set' || tag === 'animatetransform') &&
            /^(xlink:)?href$/i.test(el.getAttribute('attributeName') || '')) {
            el.remove();
            return;
        }

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value;

            if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
            if (name === 'style') { el.setAttribute(attr.name, _exportSanitizeCss(value)); continue; }
            if (!EXPORT_URL_ATTRS.has(name)) continue;

            const u = _exportNormalizeUrl(value);
            if (name === 'srcset') { el.removeAttribute(attr.name); continue; }
            if (/^(javascript|vbscript):/.test(u)) { el.removeAttribute(attr.name); continue; }
            if (u.startsWith('data:') && !(u.startsWith('data:image/') && !u.startsWith('data:image/svg'))) {
                el.removeAttribute(attr.name); continue;           // data:text/html、data:image/svg+xml 等
            }

            const external = /^https?:\/\//.test(u) || u.startsWith('//');
            if (!external) continue;                               // 錨點 / 相對路徑 / 安全 data:image
            if (tag === 'a' && name === 'href') {                  // 超連結不會自動請求，保留但隔離
                el.setAttribute('rel', 'noopener noreferrer');
                el.setAttribute('target', '_blank');
                continue;
            }
            if (_exportIsAllowedUrl(value)) continue;
            if (tag === 'img' && name === 'src') {
                el.setAttribute('src', EXPORT_PLACEHOLDER_IMG);
                el.removeAttribute('loading');
            } else {
                el.removeAttribute(attr.name);
            }
        }
    });

    return doc.body.innerHTML;
}

/* 把 JSON 安全嵌入 <script>：避免 </script>、<!-- 與 U+2028/2029 */
function _exportJsonForScript(data) {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
}

function _exportEscHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 播放器範本。{{...}} 為注入點 */
const EXPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE}}</title>
<!-- CDN 版本：Tailwind 3.4.17、Font Awesome 6.5.1。離線時投影片樣式可能不完整，播放器本身不受影響。 -->
<link rel="stylesheet" href="{{FA_CSS}}">
<script src="{{TAILWIND_JS}}"><\/script>
<script>
if (window.tailwind) tailwind.config = { theme: { extend: { fontFamily: { sans: ['"PingFang TC"', '"Microsoft JhengHei"', '"Noto Sans TC"', 'sans-serif'] } } } };
<\/script>
<style>
html,body{margin:0}
body{box-sizing:border-box;min-height:100vh;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif;background:#f4f4f5;color:#18181b;display:flex;flex-direction:column;align-items:center;padding:16px;gap:14px}
@media (prefers-color-scheme:dark){body{background:#09090b;color:#f4f4f5}.bar{background:#18181b!important;border-color:#27272a!important}.bar button:hover{background:#27272a!important}.thumb{background:#18181b!important;border-color:#27272a!important}.thumb.on{border-color:#f4f4f5!important}}
.ex-title{font-size:18px;margin:4px 0 0;text-align:center}
#stage{position:relative;width:100%;max-width:min(1024px,max(480px,calc((100vh - 330px)*16/9)))}
#canvas{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:#fff;color:#18181b;border-radius:12px;border:1px solid #e4e4e7;box-shadow:0 4px 16px rgba(0,0,0,.12)}
#stage:fullscreen{max-width:none;background:#000;display:flex;align-items:center;justify-content:center}
#stage:fullscreen #canvas{width:min(100vw,calc(100vh*16/9));border-radius:0;border:0;box-shadow:none}
#stage:fullscreen .ui{display:none}
.slide-anim{width:100%;height:100%}
.slide-scaler{position:relative;width:1024px;height:576px;transform-origin:top left}
@keyframes inR{from{opacity:0;transform:translateX(48px) scale(.98)}to{opacity:1;transform:none}}
@keyframes inL{from{opacity:0;transform:translateX(-48px) scale(.98)}to{opacity:1;transform:none}}
@keyframes inF{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes fadeUp{from{opacity:0;transform:translateY(24px) scale(.985)}to{opacity:1;transform:none}}
.in-right{animation:inR .5s cubic-bezier(.2,.8,.2,1) both}
.in-left{animation:inL .5s cubic-bezier(.2,.8,.2,1) both}
.in-fade{animation:inF .5s cubic-bezier(.2,.8,.2,1) both}
.reveal{animation:fadeUp .6s cubic-bezier(.2,.8,.2,1) both}
.stagger>*{animation:fadeUp .55s cubic-bezier(.2,.8,.2,1) both}
.stagger>*:nth-child(1){animation-delay:.04s}.stagger>*:nth-child(2){animation-delay:.10s}.stagger>*:nth-child(3){animation-delay:.16s}.stagger>*:nth-child(4){animation-delay:.22s}.stagger>*:nth-child(5){animation-delay:.28s}.stagger>*:nth-child(n+6){animation-delay:.34s}
#progress{position:absolute;left:0;bottom:0;height:4px;width:0;background:linear-gradient(90deg,#3b82f6,#a855f7,#ec4899);transition:width .4s}
.bar{flex:none;display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e4e4e7;border-radius:999px;padding:6px 12px}
.bar button{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:600;height:32px;min-width:32px;padding:0 10px;border-radius:999px;cursor:pointer}
.bar button:hover:not(:disabled){background:#f4f4f5}
.bar button:disabled{opacity:.4;cursor:not-allowed}
#counter{font:12px ui-monospace,monospace;width:60px;text-align:center}
#thumbs{flex:none;display:flex;gap:12px;width:100%;max-width:1024px;overflow-x:auto;padding:6px 4px;scrollbar-width:none}
#thumbs::-webkit-scrollbar{display:none}
.thumb{position:relative;flex:0 0 176px;padding:0;overflow:hidden;background:#fff;border:1px solid #e4e4e7;border-radius:8px;cursor:pointer;opacity:.6;transition:all .3s;color:inherit;font:inherit}
.thumb .ti{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;pointer-events:none;user-select:none;text-align:left}
.thumb .ti .slide-scaler{color:#18181b}
.thumb:hover{opacity:1}
.thumb.on{opacity:1;border-color:#18181b;box-shadow:0 0 0 2px #18181b;transform:scale(1.05)}
.thumb i{position:absolute;left:6px;top:6px;z-index:1;padding:1px 6px;border-radius:4px;background:rgba(0,0,0,.65);color:#fff;font:normal 10px ui-monospace,monospace}
.hint{flex:none;font-size:11px;color:#a1a1aa;margin:0}
.ex-footer{flex:none;margin:auto 0 0;padding:8px 0 4px;font-size:11px;letter-spacing:.04em;color:#a1a1aa;text-align:center;user-select:none}
@media (prefers-color-scheme:dark){.ex-footer{color:#52525b}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<h1 class="ex-title">{{TITLE}}</h1>
<div id="stage">
  <div id="canvas"></div>
  <div class="ui" id="progress"></div>
</div>
<div class="bar ui">
  <button id="prev" aria-label="上一頁">&#8592;</button>
  <span id="counter">01 / 01</span>
  <button id="next" aria-label="下一頁">&#8594;</button>
  <button id="auto" aria-label="自動播放">&#9654; 自動播放</button>
  <button id="fs" aria-label="全螢幕">全螢幕</button>
</div>
<div id="thumbs"></div>
<p class="hint">快捷鍵：← → 換頁　F 全螢幕　空白鍵 自動播放　Home / End 首尾頁</p>
<footer class="ex-footer"><i class="fa-solid fa-chalkboard" style="margin-right:4px"></i>R_Slide　·　<i class="fa-brands fa-github" style="margin-right:4px"></i>Rainless1125/R_Slide</footer>
<script>
(function () {
  var SLIDES = {{SLIDES_JSON}};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('canvas'), cur = -1, timer = null;
  var pad = function (n) { return String(n).padStart(2, '0'); };

  function fit() {
    var s = canvas.querySelector('.slide-scaler');
    if (s) s.style.transform = 'scale(' + canvas.clientWidth / 1024 + ')';
  }
  function show(i) {
    if (i < 0 || i >= SLIDES.length) return;
    var cls = reduce ? '' : (i > cur ? 'in-right' : i < cur ? 'in-left' : 'in-fade');
    cur = i;
    canvas.innerHTML = '<div class="slide-anim ' + cls + '"><div class="slide-scaler">' + SLIDES[i].html + '</div></div>';
    fit();
    document.getElementById('counter').textContent = pad(i + 1) + ' / ' + pad(SLIDES.length);
    document.getElementById('progress').style.width = ((i + 1) / SLIDES.length * 100) + '%';
    document.getElementById('prev').disabled = i === 0;
    document.getElementById('next').disabled = i === SLIDES.length - 1 && !timer;
    var ts = document.querySelectorAll('.thumb');
    for (var k = 0; k < ts.length; k++) ts[k].classList.toggle('on', k === i);
    if (ts[i] && ts[i].scrollIntoView) ts[i].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  }
  var prev = function () { show(cur - 1); }, next = function () { show(cur + 1); };

  var thumbs = document.getElementById('thumbs');
  SLIDES.forEach(function (s, i) {
    var b = document.createElement('button');
    b.className = 'thumb';
    b.setAttribute('aria-label', '第 ' + (i + 1) + ' 頁：' + s.title);
    var n = document.createElement('i'); n.textContent = pad(i + 1);
    var box = document.createElement('div'); box.className = 'ti';
    box.innerHTML = '<div class="slide-scaler">' + s.html + '</div>';
    b.appendChild(n); b.appendChild(box);
    b.onclick = function () { show(i); };
    thumbs.appendChild(b);
  });
  function fitThumbs() {
    var bs = thumbs.querySelectorAll('.ti');
    for (var k = 0; k < bs.length; k++) {
      var sc = bs[k].firstChild;
      if (bs[k].clientWidth) sc.style.transform = 'scale(' + bs[k].clientWidth / 1024 + ')';
    }
  }
  fitThumbs();
  window.addEventListener('resize', fitThumbs);

  function toggleAuto() {
    var btn = document.getElementById('auto');
    if (timer) { clearInterval(timer); timer = null; btn.innerHTML = '&#9654; 自動播放'; }
    else {
      timer = setInterval(function () { show(cur >= SLIDES.length - 1 ? 0 : cur + 1); }, 4500);
      btn.innerHTML = '&#10074;&#10074; 播放中'; document.getElementById('next').disabled = false;
    }
  }
  function toggleFs() {
    var st = document.getElementById('stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (st.requestFullscreen) st.requestFullscreen();
  }
  document.getElementById('prev').onclick = prev;
  document.getElementById('next').onclick = next;
  document.getElementById('auto').onclick = toggleAuto;
  document.getElementById('fs').onclick = toggleFs;
  document.addEventListener('fullscreenchange', function () { setTimeout(fit, 50); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(SLIDES.length - 1);
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === ' ') { e.preventDefault(); toggleAuto(); }
  });
  var sx = 0, sy = 0;
  canvas.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? next() : prev();
  }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas); else window.addEventListener('resize', fit);
  show(0);
})();
<\/script>
</body>
</html>`;

function buildExportHtml(title, slides) {
    const data = (slides || []).map(s => ({
        title: String(s.slide_title ?? ''),
        html: sanitizeSlideHtml(s.html_content),
    }));
    // 用函式取代，避免 $& 等特殊序列被 String.replace 解讀
    const fill = { '{{TITLE}}': _exportEscHtml(title || '未命名簡報'), '{{FA_CSS}}': EXPORT_CDN.fontAwesome, '{{TAILWIND_JS}}': EXPORT_CDN.tailwind };
    let out = EXPORT_TEMPLATE;
    for (const k in fill) out = out.split(k).join(fill[k]);
    return out.split('{{SLIDES_JSON}}').join(_exportJsonForScript(data));
}

function exportPresentationHtml() {
    if (!currentPresentationData || !Array.isArray(currentPresentationData.slides) || !currentPresentationData.slides.length) {
        showToast('沒有可匯出的簡報', 'error');
        return;
    }
    const title = currentPresentationData.presentation_title || '未命名簡報';
    const html = buildExportHtml(title, currentPresentationData.slides);
    _exportDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), title, 'html');
    showToast('已匯出 HTML', 'success', 1800);
}

function _exportDownload(blob, title, ext) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'presentation') + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ===================== 匯出 PDF / PPTX ===================== */
// 在畫面外以 1024×576 逐頁渲染並轉成 2 倍解析度的 JPEG，
// PDF 在瀏覽器端用 jsPDF 組成；PPTX 交給後端 /api/export/pptx（python-pptx）組成。
// 每頁都是一張圖片，外觀與畫面一致，但匯出後文字無法再編輯。
const EXPORT_W = 1024, EXPORT_H = 576;
const EXPORT_LIBS = {
    htmlToImage: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js',
        integrity: 'sha512-7tWCgq9tTYS/QkGVyKrtLpqAoMV9XIUxoou+sPUypsaZx56cYR/qio84fPK9EvJJtKvJEwt7vkn6je5UVzGevw==',
        global: 'htmlToImage'
    },
    jspdf: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        integrity: 'sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfcEqDTTHgtNA==',
        global: 'jspdf'
    }
};
const _exportLibLoading = {};
let _exportBusy = false;

// 第一次匯出時才載入函式庫，不影響一般使用的載入速度
function _exportLoadLib(name) {
    const lib = EXPORT_LIBS[name];
    if (window[lib.global]) return Promise.resolve(window[lib.global]);
    if (!_exportLibLoading[name]) {
        _exportLibLoading[name] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = lib.url;
            s.integrity = lib.integrity;
            s.crossOrigin = 'anonymous';
            s.referrerPolicy = 'no-referrer';
            s.onload = () => resolve(window[lib.global]);
            s.onerror = () => {
                delete _exportLibLoading[name];
                s.remove();
                reject(new Error('無法載入匯出元件，請確認網路可連線至 cdnjs.cloudflare.com'));
            };
            document.head.appendChild(s);
        });
    }
    return _exportLibLoading[name];
}

async function _exportRenderSlides(slides, onProgress) {
    const h2i = await _exportLoadLib('htmlToImage');
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-${EXPORT_W * 4}px;top:0;width:${EXPORT_W}px;height:${EXPORT_H}px;overflow:hidden;pointer-events:none`;
    document.body.appendChild(host);
    try {
        await document.fonts.ready;
        let fontEmbedCSS;
        const images = [];
        for (let i = 0; i < slides.length; i++) {
            onProgress(i + 1, slides.length);
            // 與 HTML 匯出相同：白底、預設深灰字
            const frame = document.createElement('div');
            frame.style.cssText = `width:${EXPORT_W}px;height:${EXPORT_H}px;overflow:hidden;background:#fff;color:#18181b`;
            frame.innerHTML = '<div class="slide-scaler">' + slides[i].html_content + '</div>';
            host.replaceChildren(frame);
            // 等 Tailwind CDN 產生新 class 的樣式（背景分頁中 requestAnimationFrame 不會觸發，因此用 setTimeout）
            await new Promise(r => setTimeout(r, 80));
            // 字型（Font Awesome 圖示等）只需內嵌一次，之後各頁共用
            if (fontEmbedCSS === undefined) fontEmbedCSS = await h2i.getFontEmbedCSS(frame).catch(() => '');
            images.push(await h2i.toJpeg(frame, {
                width: EXPORT_W, height: EXPORT_H, pixelRatio: 2, quality: 0.92,
                backgroundColor: '#ffffff', fontEmbedCSS
            }));
        }
        return images;
    } finally {
        host.remove();
    }
}

function _exportSetBusy(busy, label) {
    _exportBusy = busy;
    const btn = document.getElementById('exportBtn');
    if (!btn) return;
    btn.disabled = busy;
    document.getElementById('exportIcon').className = 'text-[11px] fa-solid ' + (busy ? 'fa-circle-notch fa-spin' : 'fa-file-export');
    document.getElementById('exportLabel').textContent = busy ? label : '匯出';
}

async function _exportRun(kind, build) {
    if (!currentPresentationData || !Array.isArray(currentPresentationData.slides) || !currentPresentationData.slides.length) {
        showToast('沒有可匯出的簡報', 'error');
        return;
    }
    if (_exportBusy) return;
    if (typeof toggleEditMode === 'function') toggleEditMode(false); // 先把編輯中的文字寫回資料
    if (typeof stopAutoplay === 'function') stopAutoplay();
    const title = currentPresentationData.presentation_title || '未命名簡報';
    const slides = currentPresentationData.slides.slice();
    _exportSetBusy(true, '準備中…');
    try {
        const images = await _exportRenderSlides(slides, (i, n) => _exportSetBusy(true, `轉換中 ${i}/${n}`));
        _exportSetBusy(true, `產生 ${kind}…`);
        const blob = await build(images, title, slides);
        _exportDownload(blob, title, kind.toLowerCase());
        showToast(`已匯出 ${kind}`, 'success', 1800);
    } catch (err) {
        showToast(typeof friendlyError === 'function' ? friendlyError(err) : String(err?.message || err), 'error', 6000);
    } finally {
        _exportSetBusy(false);
    }
}

function exportPresentationPdf() {
    return _exportRun('PDF', async (images, title) => {
        const { jsPDF } = await _exportLoadLib('jspdf');
        // 1024×576 px 以 72dpi 換算為 768×432 pt（16:9）
        const W = 768, H = 432;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H], compress: true });
        images.forEach((img, i) => {
            if (i) pdf.addPage([W, H], 'landscape');
            pdf.addImage(img, 'JPEG', 0, 0, W, H, undefined, 'FAST');
        });
        pdf.setProperties({ title, creator: 'R Slide' });
        return pdf.output('blob');
    });
}

function exportPresentationPptx() {
    return _exportRun('PPTX', async (images, title, slides) => {
        const res = await fetch('/api/export/pptx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, slides: slides.map((s, i) => ({ title: s.slide_title, image: images[i] })) })
        });
        if (!res.ok) throw await readApiError(res);
        return res.blob();
    });
}
