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


class ChartSpec(BaseModel):
    type: Literal["bar", "horizontal_bar", "line", "pie", "doughnut"] = Field(
        description="bar=直條（類別比較）、horizontal_bar=橫條（類別名稱較長或排名）、line=折線（時間趨勢）、"
                    "pie / doughnut=圓餅 / 環圈（占比，只使用第一個資料系列，類別 2~6 個）"
    )
    title: str = Field(description="圖表標題（15 字內）；若投影片標題已說明清楚可為空字串")
    unit: str = Field(description="數值單位，例如 %、億元、萬人；沒有單位就給空字串")
    labels: list[str] = Field(description="類別或時間點標籤（最多 12 個，每個 10 字內）")
    datasets: list[ChartDataset] = Field(description="資料系列（1~3 個）")
    colors: list[str] = Field(description="各系列（圓餅圖為各扇形）的 HEX 色碼，需符合視覺風格，例如 #2563eb；可為空陣列使用預設配色")


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
    return {
        "type": chart_type,
        "title": _clean_text(raw.get("title")),
        "unit": _clean_text(raw.get("unit"), 12),
        "labels": labels,
        "datasets": datasets,
        "colors": [c.strip() for c in colors][:MAX_LABELS],
    }


def normalize_charts(charts) -> list[dict]:
    if not isinstance(charts, list):
        return []
    return [c for c in (normalize_chart(x) for x in charts[:MAX_CHARTS_PER_SLIDE]) if c]


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
    6. 該頁沒有圖表時，charts 請輸出空陣列 []。
"""
