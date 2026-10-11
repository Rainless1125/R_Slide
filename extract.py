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


PAGE_NUMBER_RE = re.compile(r"(?:-\s*)?(?:page\s*)?\d{1,4}(?:\s*/\s*\d{1,4})?(?:\s*-)?|第\s*\d{1,4}\s*頁", re.I)


def _strip_page_number(page_text: str) -> str:
    """只移除每頁頭尾的頁碼行，避免誤刪內文中單獨成行的數據。"""
    lines = page_text.strip().split("\n")
    if lines and PAGE_NUMBER_RE.fullmatch(lines[-1].strip()):
        lines.pop()
    if lines and PAGE_NUMBER_RE.fullmatch(lines[0].strip()):
        lines.pop(0)
    return "\n".join(lines).strip()


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
    text = "\n\n".join(p for p in map(_strip_page_number, pages) if p)
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


def _extract_docx(data: bytes) -> tuple[str, None]:
    try:
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
