"""static/export.js 的 sanitizeSlideHtml：擋住 AI 產生的惡意 HTML（素材中的提示注入可能讓 AI 輸出 script、onerror 等）。

清理依賴瀏覽器的 DOMParser 與 HTML 解析規則（mXSS 只在真正的瀏覽器解析器上重現），所以用 Playwright 在 Chromium 中執行。
需要先安裝：pip install playwright && python -m playwright install chromium；沒有安裝時整個檔案略過。
"""
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api", reason="未安裝 playwright，略過前端 HTML 清理測試")

EXPORT_JS = Path(__file__).resolve().parent.parent / "static" / "export.js"

# 每段攻擊字串若成功執行，會呼叫 __pwned()
ATTACKS = {
    "script": "<script>__pwned()</script>",
    "img_onerror": "<img src=x onerror=__pwned()>",
    "svg_onload": "<svg onload=__pwned()><circle r=5 /></svg>",
    "body_onload_mixed_case": "<div OnMouseOver=__pwned() oNcLiCk=__pwned()>x</div>",
    "a_javascript": '<a href="javascript:__pwned()">x</a>',
    "a_javascript_obfuscated": '<a href=" JaVa&#9;ScRiPt&#x3A;__pwned()">x</a>',
    "a_vbscript": '<a href="vbscript:msgbox(1)">x</a>',
    "svg_a_javascript": '<svg><a href="javascript:__pwned()"><text y="20">x</text></a></svg>',
    "svg_a_xlink_javascript": '<svg><a xlink:href="javascript:__pwned()"><text y="20">x</text></a></svg>',
    "svg_animate_href": '<svg><a><animate attributeName="href" values="javascript:__pwned()"/>'
                        '<text y="20">x</text></a></svg>',
    "svg_set_xlink_href": '<svg><a><set attributeName="xlink:href" to="javascript:__pwned()"/>'
                          '<text y="20">x</text></a></svg>',
    "svg_foreignobject": '<svg><foreignObject><img src=x onerror=__pwned()></foreignObject></svg>',
    "iframe_data_html": '<iframe src="data:text/html,<script>parent.__pwned()</script>"></iframe>',
    "iframe_srcdoc": '<iframe srcdoc="<script>parent.__pwned()</script>"></iframe>',
    "a_data_html": '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    "img_data_svg": '<img src="data:image/svg+xml,<svg onload=__pwned()>">',
    "object_data": '<object data="javascript:__pwned()"></object>',
    "embed_src": '<embed src="javascript:__pwned()">',
    "form_action": '<form action="javascript:__pwned()"><button>x</button></form>',
    "button_formaction": '<button formaction="javascript:__pwned()">x</button>',
    "meta_refresh": '<meta http-equiv="refresh" content="0;url=javascript:__pwned()">',
    "base_href": '<base href="https://evil.example/">',
    "link_stylesheet": '<link rel="stylesheet" href="https://evil.example/x.css">',
    "math_mxss": '<math><mtext><table><mglyph><style><img src=x onerror=__pwned()></style></mglyph></table></mtext></math>',
    "math_href": '<math href="javascript:__pwned()">x</math>',
    "noscript_mxss": '<noscript><p title="</noscript><img src=x onerror=__pwned()>"></p></noscript>',
    "template_content": '<template><img src=x onerror=__pwned()></template>',
    "svg_style_mxss": '<svg></p><style><a id="</style><img src=x onerror=__pwned()>"></svg>',
    "style_import": "<style>@import 'https://evil.example/x.css';</style>",
    "style_url_javascript": '<div style="background:url(javascript:__pwned())">x</div>',
    "style_url_escaped": '<div style="background:\\75rl(https://evil.example/track.png)">x</div>',
    "style_expression": '<div style="width:expression(__pwned())">x</div>',
    "style_font_face": "<style>@font-face{font-family:x;src:url(https://evil.example/f.woff)}</style>",
    "style_image_set": "<div style=\"background:image-set('https://evil.example/t.png' 1x)\">x</div>",
    "img_external": '<img src="https://evil.example/track.png">',
    "img_srcset": '<img srcset="https://evil.example/a.png 1x">',
    "video_poster": '<video poster="https://evil.example/p.png"></video>',
}

DROP_TAGS = {"script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form",
             "foreignobject", "audio", "video", "source", "track", "math", "noscript", "template"}

# 在瀏覽器中檢查清理結果：回傳違規清單（空清單表示安全）
CHECK_JS = r"""
(html) => {
    const problems = [];
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const norm = v => String(v).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
    const allowedHost = u => {
        try { return ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com'].includes(new URL(u.startsWith('//') ? 'https:' + u : u).hostname); }
        catch (_) { return false; }
    };
    const badCss = css => {
        const c = norm(css);
        if (/@import|expression\(|javascript:|behavior:|-moz-binding|image-set\(|@font-face/.test(c)) return true;
        for (const m of c.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
            const u = m[2];
            if (u.startsWith('#') || (u.startsWith('data:image/') && !u.startsWith('data:image/svg'))) continue;
            if (!allowedHost(u)) return true;
        }
        return false;
    };
    for (const el of tpl.content.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        if (DROP.includes(tag)) problems.push('tag ' + tag);
        if (tag === 'style' && badCss(el.textContent)) problems.push('style ' + el.textContent);
        for (const a of el.attributes) {
            const name = a.name.toLowerCase(), u = norm(a.value);
            if (name.startsWith('on')) problems.push('attr ' + name);
            if (name === 'srcdoc' || name === 'srcset') problems.push('attr ' + name);
            if (name === 'style' && badCss(a.value)) problems.push('style attr ' + a.value);
            if (/^(javascript|vbscript):/.test(u)) problems.push(name + '=' + a.value);
            if (u.startsWith('data:') && !(u.startsWith('data:image/') && !u.startsWith('data:image/svg'))
                && a.value !== PLACEHOLDER) problems.push(name + '=' + a.value.slice(0, 40));
            const external = /^https?:\/\//.test(u) || u.startsWith('//');
            if (external && !(tag === 'a' && name === 'href') && !allowedHost(u)) problems.push(name + '=' + a.value);
        }
    }
    return problems;
}
"""


@pytest.fixture(scope="module")
def page():
    with sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:                      # 安裝了套件但沒有下載瀏覽器
            pytest.skip(f"無法啟動 Chromium（請執行 python -m playwright install chromium）：{e}")
        pg = browser.new_page()
        pg.set_content("<!DOCTYPE html><html><body><div id='stage'></div></body></html>")
        pg.add_script_tag(content=EXPORT_JS.read_text(encoding="utf-8"))
        pg.evaluate("""() => {
            window.__hits = 0;
            window.__pwned = () => { window.__hits++; };
            window.DROP = %s;
            window.PLACEHOLDER = EXPORT_PLACEHOLDER_IMG;
        }""" % sorted(DROP_TAGS))
        yield pg
        browser.close()


def sanitize(page, html: str) -> str:
    return page.evaluate("html => sanitizeSlideHtml(html)", html)


def test_drop_tags_cover_known_dangerous_tags(page):
    """有人從 EXPORT_DROP_TAGS 刪掉標籤時，這裡會失敗。"""
    assert set(page.evaluate("() => Array.from(EXPORT_DROP_TAGS)")) >= DROP_TAGS


@pytest.mark.parametrize("payload", ATTACKS.values(), ids=ATTACKS.keys())
def test_attack_is_neutralized(page, payload):
    # 包在正常內容中，模擬 AI 輸出的投影片
    out = sanitize(page, f'<div class="p-8"><h1>標題</h1>{payload}<p>內文</p></div>')
    assert page.evaluate(CHECK_JS, out) == [], out
    assert "標題" in out and "內文" in out

    # 實際插入頁面（與 index.html 顯示投影片相同的 innerHTML），確認沒有程式被執行
    page.evaluate("html => { window.__hits = 0; document.getElementById('stage').innerHTML = html; }", out)
    page.wait_for_timeout(50)
    assert page.evaluate("() => window.__hits") == 0, out


def test_output_is_stable(page):
    """清理結果再清理一次不應改變（否則代表重新解析後結構變形，可能是 mXSS）。"""
    for payload in ATTACKS.values():
        once = sanitize(page, payload)
        assert sanitize(page, once) == once, payload


def test_safe_content_is_kept(page):
    png = "data:image/png;base64,iVBORw0KGgo="
    html = (f'<div class="grid" style="color:#123456;background:url(#grad)"><img src="{png}" alt="圖">'
            '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="5" height="5"/></svg>'
            '<a href="https://example.com/doc">參考資料</a><i class="fa-solid fa-chart-line"></i></div>')
    out = sanitize(page, html)
    for kept in (png, 'class="grid"', "color:#123456", "url(#grad)", "linearGradient", "fa-chart-line", "參考資料"):
        assert kept in out
    assert 'href="https://example.com/doc"' in out
    assert 'rel="noopener noreferrer"' in out and 'target="_blank"' in out


def test_external_image_becomes_placeholder(page):
    out = sanitize(page, '<img src="https://evil.example/track.png" loading="lazy">')
    assert "evil.example" not in out
    assert page.evaluate("""html => { const t = document.createElement('template'); t.innerHTML = html;
                                      return t.content.querySelector('img').getAttribute('src') === EXPORT_PLACEHOLDER_IMG; }""", out)
