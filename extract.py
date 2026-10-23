"""從上傳檔案抽取純文字（PDF / DOCX / Markdown / TXT），不保存檔案。"""
import io
import os
import re
import zipfile

from docx import Document
from docx.table import Table
from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# .docx 是 zip 壓縮檔：解壓縮後的總大小上限，避免很小的檔案解壓出數 GB 的資料（zip bomb）把記憶體用光。
# 一般文件解壓後多在數 MB 以內，內嵌大量圖片時才會較大
MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".md", ".markdown", ".txt"}
TEXT_ENCODINGS = ("utf-8-sig", "cp950", "big5hkscs")


class ExtractError(Exception):
    """可直接顯示給使用者的抽取錯誤。"""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# 有明確頁碼格式的行（Page 3、- 3 -、3 / 10、第 3 頁）一律視為頁碼
PAGE_LABEL_RE = re.compile(r"page\s*\d{1,4}(?:\s*(?:/|of)\s*\d{1,4})?|-\s*\d{1,4}\s*-|\d{1,4}\s*/\s*\d{1,4}|第\s*\d{1,4}\s*頁", re.I)
# 只有數字的行可能是內文數據（年份、金額），需確認它跟著頁序遞增才移除
BARE_NUMBER_RE = re.compile(r"\d{1,4}")
# 頁碼與頁序的差值上限（封面、目錄不編號或以羅馬數字編號造成的位移）；
# 連續頁面結尾剛好是 2023、2024 這類遞增數據時，差值會大到不合理，不視為頁碼
MAX_PAGE_OFFSET = 100


def _page_number_offset(pages: list[list[str]]) -> int | None:
    """找出「頁首 / 頁尾數字 − 頁序」最常見的差值（容許封面不編號等固定位移）。
    至少一半的頁面（且至少 2 頁；單頁 PDF 則必須剛好是 1）符合才視為頁碼，否則回傳 None。"""
    counts: dict[int, int] = {}
    for i, lines in enumerate(pages, 1):
        ends = {lines[0].strip(), lines[-1].strip()} if lines else set()
        offsets = {int(line) - i for line in ends if BARE_NUMBER_RE.fullmatch(line)}
        offsets = {off for off in offsets if abs(off) <= MAX_PAGE_OFFSET}
        for off in offsets:
            counts[off] = counts.get(off, 0) + 1
    if not counts:
        return None
    if len(pages) == 1:
        return 0 if 0 in counts else None
    offset, hits = max(counts.items(), key=lambda kv: kv[1])
    return offset if hits >= max(2, (len(pages) + 1) // 2) else None


def _running_numbers(pages: list[list[str]], pos: int) -> set[str]:
    """每頁同一位置（第一行 / 最後一行）都出現的相同數字，例如頁首 / 頁尾的年份「2024」。
    至少 3 頁、且 60% 以上的頁面相同才算，避免把少數頁面剛好相同的數據當成頁首 / 頁尾。"""
    if len(pages) < 3:
        return set()
    counts: dict[str, int] = {}
    for lines in pages:
        line = lines[pos].strip() if lines else ""
        if BARE_NUMBER_RE.fullmatch(line):
            counts[line] = counts.get(line, 0) + 1
    need = max(3, -(-len(pages) * 3 // 5))   # ceil(60%)
    return {v for v, c in counts.items() if c >= need}


def _strip_page_numbers(pages: list[str]) -> list[str]:
    """只移除每頁頭尾的頁碼與頁首 / 頁尾行，避免誤刪內文中單獨成行的數據。"""
    split = [p.strip().split("\n") for p in pages]
    offset = _page_number_offset(split)
    running = {-1: _running_numbers(split, -1), 0: _running_numbers(split, 0)}

    def is_page_number(line: str, page: int, pos: int) -> bool:
        line = line.strip()
        if PAGE_LABEL_RE.fullmatch(line) or line in running[pos]:
            return True
        return offset is not None and bool(BARE_NUMBER_RE.fullmatch(line)) and int(line) - page == offset

    out = []
    for i, lines in enumerate(split, 1):
        if lines and is_page_number(lines[-1], i, -1):
            lines = lines[:-1]
        if lines and is_page_number(lines[0], i, 0):
            lines = lines[1:]
        out.append("\n".join(lines).strip())
    return out


def _extract_pdf(data: bytes) -> tuple[str, int]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractError("此 PDF 有密碼保護，請先解除密碼後再上傳")
        pages = [page.extract_text() or "" for page in reader.pages]
    except ExtractError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError) as e:
        raise ExtractError("無法讀取此 PDF，檔案可能已損毀") from e
    text = "\n\n".join(p for p in _strip_page_numbers(pages) if p)
    if not text:
        raise ExtractError("此 PDF 抽不到文字，可能是掃描影像檔，目前不支援", 422)
    return text, len(pages)


def _table_to_text(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            value = " ".join(cell.text.split())
            # 合併儲存格在 python-docx 中會重複出現，略過相鄰的重複值
            if not cells or cells[-1] != value:
                cells.append(value)
        if any(cells):
            rows.append(" | ".join(cells))
    return "\n".join(rows)


def _check_docx_size(data: bytes):
    """以 zip 目錄記錄的解壓縮大小檢查；zipfile 讀取每個檔案時最多只輸出記錄的大小，因此這個總和就是實際上限。"""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        total = sum(info.file_size for info in zf.infolist())
    if total > MAX_DOCX_UNCOMPRESSED_BYTES:
        raise ExtractError("Word 檔解壓縮後的內容過大，無法讀取", 413)


def _extract_docx(data: bytes) -> tuple[str, None]:
    try:
        _check_docx_size(data)
        doc = Document(io.BytesIO(data))
    except (zipfile.BadZipFile, KeyError, ValueError) as e:
        raise ExtractError("無法讀取此 Word 檔，請確認為 .docx 格式（舊版 .doc 請先另存新檔）") from e
    blocks = []
    for item in doc.iter_inner_content():
        if isinstance(item, Table):
            blocks.append(_table_to_text(item))
            continue
        text = item.text.strip()
        if not text:
            continue
        style = (item.style.name if item.style is not None else "") or ""
        level = re.match(r"Heading (\d)", style)
        if style == "Title":
            text = "# " + text
        elif level:
            text = "#" * min(int(level.group(1)) + 1, 6) + " " + text
        elif style.startswith("List"):
            text = "- " + text
        blocks.append(text)
    return "\n\n".join(b for b in blocks if b), None


def _extract_plain(data: bytes) -> tuple[str, None]:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16"), None
    for enc in TEXT_ENCODINGS:
        try:
            return data.decode(enc), None
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), None


def extract_text(filename: str, data: bytes, max_chars: int) -> dict:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ExtractError("不支援的檔案格式，目前支援 PDF、DOCX、Markdown、TXT", 415)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ExtractError(f"檔案過大（上限 {MAX_UPLOAD_BYTES // 1024 // 1024} MB）", 413)
    if not data:
        raise ExtractError("檔案是空的")

    if ext == ".pdf":
        text, pages = _extract_pdf(data)
    elif ext == ".docx":
        text, pages = _extract_docx(data)
    else:
        text, pages = _extract_plain(data)

    text = _clean_text(text)
    if not text:
        raise ExtractError("檔案中沒有可用的文字內容", 422)
    total_chars = len(text)
    truncated = total_chars > max_chars
    return {
        "text": text[:max_chars] if truncated else text,
        "filename": os.path.basename(filename),
        "pages": pages,
        "chars": total_chars,
        "truncated": truncated,
    }
