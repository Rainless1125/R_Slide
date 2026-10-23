"""整份簡報的設計規範（theme）、版型目錄與頁面節奏：讓 LLM 先決定共用的配色與樣式再產生每一頁，
並從固定的版型目錄中依內容挑選版型，避免各頁配色不一致、版型重複。

theme 存在簡報資料（currentPresentationData.theme）並跟著歷史記錄保存；單頁重產時前端送回，
讓重產的頁面沿用同一套規範。舊的簡報沒有 theme，重產時改為參考原頁面的樣式。
"""
import json
import re

from pydantic import BaseModel, Field

HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
MAX_THEME_TEXT = 300           # 每個 theme 欄位的字數上限（送回後端重產時檢查）
MAX_THEME_CHART_COLORS = 6


# 注意：LLM 用的 schema 不可有預設值（Gemini 的 response_schema 不支援 default），所有欄位都是必填
class DeckTheme(BaseModel):
    design_direction: str = Field(description="整體設計方向，一句話描述（例如「白底極簡、深藍強調、大量留白的商務風格」）")
    page_background: str = Field(description="內容頁的頁面背景 Tailwind class，例如 bg-white、bg-slate-950，"
                                             "或漸層 bg-gradient-to-br from-slate-50 to-white")
    text_primary: str = Field(description="主要文字顏色 class，例如 text-slate-900")
    text_secondary: str = Field(description="次要文字（說明、註記）顏色 class，例如 text-slate-500")
    accent: str = Field(description="強調色的 Tailwind 色名與色階（不含 text- / bg- 前綴），例如 indigo-600；"
                                    "用於重點數字、小標籤、圖示與重點線條")
    accent_soft: str = Field(description="強調色的淺底色名與色階（不含前綴），用於圖示底、標籤底與重點區塊，例如 indigo-50")
    card_style: str = Field(description="卡片的 class 組合（背景、邊框、圓角、陰影、內距），"
                                        "例如 bg-slate-50 border border-slate-200 rounded-2xl p-6")
    heading_style: str = Field(description="主標題的 class 組合（字級、粗細、字距、顏色），例如 text-4xl font-bold tracking-tight text-slate-900")
    eyebrow_style: str = Field(description="主標題上方小標籤的 class 組合，例如 text-xs font-semibold uppercase tracking-widest text-indigo-600")
    chart_colors: list[str] = Field(description="圖表依序使用的 HEX 色碼（3~5 個），第一個與強調色一致，彼此容易區分")


THEME_FIELDS = tuple(DeckTheme.model_fields)

THEME_RULES = """
    【整份簡報的設計規範（theme：先決定，再套用到每一頁）】：
    1. 先在 theme 欄位決定整份簡報共用的設計規範，必須符合【指定視覺風格】；再依 theme 產生每一頁。
    2. 每一頁都直接使用 theme 中的 class：頁面背景、主要 / 次要文字顏色、卡片樣式、主標題與小標籤樣式，
       不要每頁各自發明新的配色、卡片或標題樣式。
    3. 強調色（accent / accent_soft）只用在需要被注意的地方：重點數字、小標籤、圖示與圖示底、重點線條；
       一頁之中除了中性色之外只用強調色這一個色系，讓畫面乾淨一致。
    4. 封面、章節分隔頁與結尾頁可以改用強調色或深色作為整頁背景來製造節奏，但顏色仍須來自 theme。
    5. 圖表的 colors 依序使用 theme.chart_colors。
"""

LAYOUT_CATALOG = """
    【版型目錄（依內容選擇最適合的版型；layout_concept 請寫出版型名稱與畫面結構，例如「圖表 + 解讀：滿版圖表、下方三個重點」）】：
    - 封面：大標題 + 副標題 + 一行補充（單位、日期或講者）；素材有代表性的關鍵數字時，可在另一側放大呈現，讓封面有記憶點。
    - 議程 / 目錄：3~6 個章節，搭配編號或圖示。
    - 章節分隔：章節編號與章節名稱，可用強調色滿版背景。
    - KPI 大數字：1~4 個關鍵數字，各附說明與變化（↑↓、百分比、比較基準）。
    - 圖表 + 解讀：圖表為主角，搭配 1~3 點解讀（見【圖表】）；結構可以是圖表在左、圖表在右，
      或滿版寬度的圖表加下方一排重點。
    - 流程步驟：3~5 個橫向步驟卡，以箭頭或編號串連。
    - 時間軸：依時間排列的里程碑（年份、季度或階段）。
    - 左右對比：兩個方案、優缺點、現況與目標並排。
    - 前後對照：Before / After 兩欄，中間以箭頭連接，凸顯改變。
    - 比較表格：多個選項在多個面向的比較（最多 4 欄、5 列），以強調色標出建議選項。
    - 2×2 矩陣：以兩個維度劃分四個象限（例如影響 × 難度），每格放標題與 1~2 個項目。
    - 圖示網格：3~6 個重點，各搭配一個圖示、短標題與一句說明。
    - 金句 / 核心主張：一句主張或引言大字呈現，可附出處或一行補充。
    - 結尾 / 行動呼籲：總結 2~3 個重點與下一步行動。
    內容不適合以上任何版型時可以自行設計，但仍須遵守版面尺寸限制。
"""

DECK_RHYTHM_RULES = """
    【整份簡報的節奏】：
    1. 第一頁為封面，最後一頁為結尾 / 行動呼籲；6 頁以上時第二頁可放議程，內容分成多個章節時可加章節分隔頁。
       頁數很少（2~3 頁）時以內容頁為主，封面可以和第一個重點合併。
    2. 相鄰兩頁的畫面結構不可相同；4 頁以上時，內容頁至少使用 3 種不同的版型。
       「版型」以畫面結構判斷，而不是內容類型：兩頁都是「左邊圖表、右邊兩張卡片」就算相同，即使圖表內容不同。
       連續多頁都有數據時，請輪流變換結構，例如：圖表在左 → KPI 大數字 → 滿版圖表加下方重點 → 前後對照 → 圖表在右。
    3. 依內容選版型，不要為了變化而套用不適合的版型：有數據用 KPI 或圖表，有順序用流程或時間軸，
       有比較用對比、前後對照或表格，有多個並列重點用圖示網格。
    4. 頁數已固定時，封面、議程與結尾都算在頁數內；素材多而頁數少時，優先保留內容頁，可省略議程與章節分隔。
"""


# 標題與重點常以結論句呈現（例如「客服部與業務部低於整體」），比較與列舉最容易出錯又最顯眼，需逐一對照數字
CONTENT_ACCURACY_RULES = """
    【內容正確性】：
    1. 只使用素材中的資訊與數字，不要捏造數據、比例、原因或來源。
    2. 標題與重點中的比較性結論（高於 / 低於、最高 / 最低、唯一、全部、多數、增加 / 減少），寫出前要逐一對照素材中的每個數字確認。
    3. 列舉「哪些項目高於或低於某個值」時必須完整列出所有符合的項目，不可遺漏；項目太多時改寫成「N 個部門低於整體」這類不需列舉的說法。
    4. 同一個數字在不同頁、標題、圖表與講者備註中必須一致；計算出的差距或增減幅度（例如 3.9 − 3.6 = 0.3）要確實算對。
"""


def theme_from_input(theme) -> dict | None:
    """前端送回的 theme（重產時）：只保留已知欄位與合理的值；格式不符時回傳 None，改為參考原頁面的樣式。"""
    if not isinstance(theme, dict):
        return None
    out = {}
    for key in THEME_FIELDS:
        value = theme.get(key)
        if key == "chart_colors":
            colors = [c for c in value if isinstance(c, str) and HEX_COLOR_RE.match(c)] if isinstance(value, list) else []
            out[key] = colors[:MAX_THEME_CHART_COLORS]
        elif isinstance(value, str) and value.strip():
            out[key] = re.sub(r"\s+", " ", value).strip()[:MAX_THEME_TEXT]
    return out if any(key != "chart_colors" for key in out) else None


def format_theme(theme: dict) -> str:
    return json.dumps(theme, ensure_ascii=False, indent=2)
