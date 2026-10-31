"""企業 / 品牌識別圖示：開發者把圖片放進 brand_icon 資料夾（可用 BRAND_ICON_DIR 指定），所有使用者都能在編輯模式插入。

插入後與一般圖片相同（在瀏覽器端壓縮後內嵌在投影片中），之後替換或刪除資料夾中的檔案不影響已插入的簡報。
資料夾每次請求時重新讀取，新增或刪除圖片不需要重新啟動服務。
"""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from accounts import current_user

router = APIRouter()

DEFAULT_BRAND_ICON_DIR = Path(__file__).resolve().parent / "brand_icon"
BRAND_ICON_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}
MAX_BRAND_ICON_BYTES = 15 * 1024 * 1024     # 與前端插入圖片的上限相同（media.js 的 IMG_MAX_INPUT）
MAX_BRAND_ICONS = 200


def brand_icon_dir() -> Path:
    # 每次讀環境變數：.env 在 app.py 匯入本模組之後才載入，測試也能各自指定暫存資料夾
    return Path(os.getenv("BRAND_ICON_DIR") or DEFAULT_BRAND_ICON_DIR)


def list_brand_icons() -> list[dict]:
    """資料夾第一層中支援格式的圖片，依檔名排序；隱藏檔、子資料夾、過大的檔案與其他格式略過。"""
    folder = brand_icon_dir()
    if not folder.is_dir():
        return []
    icons = []
    for path in folder.iterdir():
        if path.name.startswith(".") or path.suffix.lower() not in BRAND_ICON_TYPES or not path.is_file():
            continue
        if path.stat().st_size > MAX_BRAND_ICON_BYTES:
            continue
        icons.append({"name": path.stem, "file": path.name})
    icons.sort(key=lambda i: i["name"].lower())
    return icons[:MAX_BRAND_ICONS]


@router.get("/api/brand-icons")
def brand_icons(user: dict = Depends(current_user)):
    return list_brand_icons()


@router.get("/api/brand-icons/{filename}")
def brand_icon_file(filename: str, user: dict = Depends(current_user)):
    # 只提供清單中的檔名（不接受路徑），避免讀到資料夾以外的檔案
    if filename not in {i["file"] for i in list_brand_icons()}:
        raise HTTPException(status_code=404, detail="找不到此品牌圖示")
    headers = {"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"}
    if filename.lower().endswith(".svg"):
        # 直接開啟 SVG 網址時不執行其中的程式碼（插入時會在瀏覽器端轉成 PNG）
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return FileResponse(brand_icon_dir() / filename, media_type=BRAND_ICON_TYPES[Path(filename).suffix.lower()],
                        headers=headers)
