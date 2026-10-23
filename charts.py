"""投影片圖表：LLM 輸出的結構化圖表資料（類型、標籤、數值）與後端正規化。

圖表不由 LLM 直接畫，而是：
  1. LLM 在 html_content 放一個佔位容器 <div data-rs-chart="0" ...></div>，
     並在 charts 陣列輸出對應的資料。
  2. 前端（static/charts.js）把資料畫成靜態 inline SVG 寫回 html_content。
因為成品是純 SVG、不需要任何 script，所以編輯、縮圖、匯出 HTML / PDF / PPTX 都能沿用現有流程，
sanitizeSlideHtml 也不必放行 Chart.js 之類的外部腳本。
"""
import math
import re
from typing import Literal

from pydantic import BaseModel, Field

CHART_TYPES = ("bar", "horizontal_bar", "line", "pie", "doughnut")
REF_LINE_TYPES = ("bar", "horizontal_bar", "line")   # 有數值軸的圖才有參考線；圓餅 / 環圈是占比，不適用
MAX_REF_LINES = 3
MAX_CHARTS_PER_SLIDE = 2
MAX_LABELS = 12
MAX_DATASETS = 4
MAX_TEXT = 40
HEX_COLOR_RE = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})")


# 注意：LLM 用的 schema 不可有預設值（Gemini 的 response_schema 不支援 default），
# 所以所有欄位都是必填，空值以空字串 / 空陣列表示。
class ChartDataset(BaseModel):
    label: str = Field(description="資料系列名稱，例如「2024」或「營收」；只有一個系列時可為空字串")
    values: list[float] = Field(description="數值，順序與數量必須和 labels 一一對應；只寫純數字，不含單位或千分位符號")


class ChartRefLine(BaseModel):
    label: str = Field(description="參考線名稱，例如「目標」「規格上限」「平均」（10 字內）")
    value: float = Field(description="參考線的數值，與資料同單位；只寫純數字")


class ChartSpec(BaseModel):
    type: Literal["bar", "horizontal_bar", "line", "pie", "doughnut"] = Field(
        description="bar=直條（類別比較）、horizontal_bar=橫條（類別名稱較長或排名）、line=折線（時間趨勢）、"
                    "pie / doughnut=圓餅 / 環圈（占比，只使用第一個資料系列，類別 2~6 個）"
    )
    title: str = Field(description="圖表標題（15 字內）；佔位容器上方的 HTML 已有圖表標題、或投影片標題已說明清楚時給空字串，避免重複")
    unit: str = Field(description="數值單位，例如 %、億元、萬人；沒有單位就給空字串")
    labels: list[str] = Field(description="類別或時間點標籤（最多 12 個，每個 10 字內）")
    datasets: list[ChartDataset] = Field(description="資料系列（1~3 個）")
    colors: list[str] = Field(description="各系列（圓餅圖為各扇形）的 HEX 色碼，需符合視覺風格，例如 #2563eb；可為空陣列使用預設配色")
    ref_lines: list[ChartRefLine] = Field(
        description="參考線（虛線），用於目標值、規格上下限、門檻或平均值；只適用 bar / horizontal_bar / line，"
                    "最多 3 條；內容沒有提到門檻或目標時給空陣列"
    )


def _clean_text(value, limit: int = MAX_TEXT) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _clean_number(value) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, str):
        value = value.replace(",", "").strip().rstrip("%")
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


def normalize_chart(raw) -> dict | None:
    """修正 LLM 常見的不一致（數量不符、字串數字、過長清單），無法使用時回傳 None。"""
    if not isinstance(raw, dict):
        return None
    chart_type = raw.get("type")
    if chart_type not in CHART_TYPES:
        return None
    labels = [_clean_text(x, 24) for x in (raw.get("labels") or [])][:MAX_LABELS]
    if not labels:
        return None

    datasets = []
    for ds in (raw.get("datasets") or [])[:MAX_DATASETS]:
        if not isinstance(ds, dict):
            continue
        values = [_clean_number(v) for v in (ds.get("values") or [])][:len(labels)]
        values += [0.0] * (len(labels) - len(values))
        datasets.append({"label": _clean_text(ds.get("label")), "values": values})
    if not datasets:
        return None
    if chart_type in ("pie", "doughnut"):
        datasets = datasets[:1]

    colors = [c for c in (raw.get("colors") or []) if isinstance(c, str) and HEX_COLOR_RE.fullmatch(c.strip())]
    ref_lines = []
    if chart_type in REF_LINE_TYPES:
        for line in (raw.get("ref_lines") or []):
            if not isinstance(line, dict) or line.get("value") in (None, ""):
                continue
            item = {"label": _clean_text(line.get("label"), 16), "value": _clean_number(line.get("value"))}
            color = line.get("color")
            if isinstance(color, str) and HEX_COLOR_RE.fullmatch(color.strip()):
                item["color"] = color.strip()
            ref_lines.append(item)
            if len(ref_lines) >= MAX_REF_LINES:
                break
    return {
        "type": chart_type,
        "title": _clean_text(raw.get("title")),
        "unit": _clean_text(raw.get("unit"), 12),
        "labels": labels,
        "datasets": datasets,
        "colors": [c.strip() for c in colors][:MAX_LABELS],
        "ref_lines": ref_lines,
    }


def normalize_charts(charts, limit: int = MAX_CHARTS_PER_SLIDE) -> list[dict | None]:
    """逐一正規化並保留原本的索引：HTML 以 data-rs-chart="索引" 對應，無法使用的圖表留下 None
    （前端找不到資料時會移除該容器），不可直接濾掉，否則後面的圖表會對到錯的容器。"""
    if not isinstance(charts, list):
        return []
    out = [normalize_chart(x) for x in charts[:limit]]
    while out and out[-1] is None:
        out.pop()
    return out


CHART_RULES = """
    【圖表（數據視覺化）】：
    1. 內容有可比較的數值（類別比較、時間趨勢、占比、排名）時，優先用圖表呈現，而不是只放大數字卡片；
       單一亮點數字仍可用大數字卡片，也可與一張圖表並排。沒有數值的頁面不要硬做圖表。
    2. 不要自己用 div / SVG 手繪圖表。請在 html_content 放一個空的佔位容器，並在 charts 陣列輸出資料：
       <div data-rs-chart="0" class="w-full h-full min-h-0"></div>
       data-rs-chart 的值是 charts 陣列的索引（0 起算）。容器內不要放任何東西，前端會自動畫出圖表。
    3. 佔位容器必須有明確的高度：放在 flex-1 min-h-0 的區塊內並使用 h-full，或直接給 h-64 ~ h-80 這類固定高度；
       建議寬度至少 400px（約半頁），圓餅 / 環圈圖可以窄一些。
    4. 每頁最多 2 張圖表；每張圖最多 8 個類別、最多 3 個資料系列。數值只寫純數字，單位放在 unit。
    5. 圖表的文字顏色會繼承佔位容器的文字顏色，請在容器或其父層設定符合視覺風格的 text-xxx；
       colors 請給與視覺風格協調、彼此容易區分的 HEX 色碼。
    6. 內容提到目標值、規格上下限、門檻、及格線或平均值時，用 ref_lines 畫成參考虛線（只用於 bar / horizontal_bar / line），
       讓觀眾一眼看出哪些資料達標；沒有這類數值時 ref_lines 給空陣列，不要自己編造門檻。
    7. 只有 2 個數值（例如今年與去年、兩個時間點）時不要用折線圖：改用 KPI 大數字並列呈現變化（例如 3.6 → 3.9，並標示與目標的差距），
       或用直條圖。折線圖至少要有 3 個時間點。
       只有一個項目的前後比較（例如「每張訂單揀貨時間 14 分鐘 → 6 分鐘」）不要畫圖表，改用大數字並列、中間以箭頭連接，
       並標示改善幅度（例如「縮短 57%」）；兩個以上項目的前後比較才用分組直條圖。
    8. 數值之間差距很小（例如 5 分制的 3.6 與 3.9）時，從 0 起算的圖表看不出差異，請改用大數字與增減幅度呈現。
    9. 圖表標題只寫一次：在佔位容器上方的 HTML 寫了圖表標題（例如卡片標題）時，charts 的 title 請給空字串；
       反之若 title 有值，HTML 就不要再寫一次相同的標題。
    10. 單位填在 unit（例如 分、%、億元），不要另外在 HTML 寫「單位：…」或「5 分制」這類重複的說明；
       百分比會直接加在每個數值後面，其他單位會顯示在圖表右上角。
    11. 該頁沒有圖表時，charts 請輸出空陣列 []。
"""
