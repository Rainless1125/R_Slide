"""static/icons.js 內建圖示清單的檢查：數量、重複、名稱格式與關鍵字。"""
import re
from pathlib import Path

ICONS_JS = Path(__file__).resolve().parent.parent / "static" / "icons.js"


def _groups():
    src = ICONS_JS.read_text(encoding="utf-8")
    blocks = re.findall(r"name: '([^']+)', en: '([^']+)', icons: \[(.*?)\n\s*\]", src, re.S)
    return [(name, en, re.findall(r"\['([^']+)', '([^']*)'\]", body)) for name, en, body in blocks]


def test_icon_count_is_300():
    assert sum(len(icons) for _, _, icons in _groups()) == 300


def test_icon_names_unique_and_valid():
    names = [n for _, _, icons in _groups() for n, _ in icons]
    assert len(names) == len(set(names))
    assert all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", n) for n in names)


def test_every_icon_has_keywords():
    for group, en, icons in _groups():
        assert group and en
        for name, kw in icons:
            assert kw.strip(), name


def test_cash_keyword_finds_money_icons():
    hits = [n for _, _, icons in _groups() for n, kw in icons if "cash" in f"{n} {kw}".lower()]
    assert {"money-bill", "cash-register", "wallet", "piggy-bank"} <= set(hits)
