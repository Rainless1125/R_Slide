"""匯入檔案時辨識圖片：PPTX 投影片中的截圖與圖表圖片、PDF 的掃描頁。每頁呼叫一次 AI，附上該頁的文字當作上下文。

結果以圖片的 key 對回原本的位置（見 extract.render_pptx），所以同一頁的原生文字與辨識結果不會錯置。
AI 呼叫由呼叫端傳入（app.py 的 call_llm），本模組只負責提示規則、分頁與併發。
"""
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from pydantic import BaseModel, Field

from extract import SourcePage, env_int, image_limit

DEFAULT_CONCURRENCY = 4
MAX_CONTEXT_CHARS = 2000      # 附給 AI 的本頁文字上限


def concurrency() -> int:
    """EXTRACT_IMAGE_CONCURRENCY：同時辨識幾頁。"""
    return env_int("EXTRACT_IMAGE_CONCURRENCY", DEFAULT_CONCURRENCY) or 1


# 注意：LLM 用的 schema 不可有預設值（Gemini 的 response_schema 不支援 default）
class ImageReading(BaseModel):
    kind: str = Field(description="圖片類型：chart（圖表）、table（表格）、text（文字截圖）、diagram（流程圖或架構圖）、"
                                  "photo（照片）、decoration（Logo、背景、裝飾圖示）")
    content: str = Field(description="圖片中的資訊轉成的文字；decoration 時為空字串")


class SlideImageReadings(BaseModel):
    images: list[ImageReading] = Field(description="依圖片順序，每張圖片一筆，數量必須與圖片數量相同")


SYSTEM_INSTRUCTION = """你是簡報內容整理助手。使用者會提供一頁投影片或文件的文字，以及這一頁中的圖片（依序附上）。
整頁掃描的文件也是一張圖片。
請把每張圖片中的資訊轉成文字，讓之後能依這些文字重新製作簡報。

規則：
1. images 依圖片順序輸出，每張圖片一筆，數量必須與圖片數量相同。
2. 圖表：第一行寫圖表類型、標題與單位，接著每個類別一行，格式為「類別 | 數值」；有多個系列時，第一行加上表頭「類別 | 系列A | 系列B」。
   圖上沒有標出數值時，依座標軸讀出近似值並在數值前加「約」。有參考線或目標線時另外寫一行。
3. 表格：保留欄與列，欄位以「 | 」分隔，第一列為表頭。
4. 文字截圖與掃描的文件頁：依原本的版面順序完整抄寫文字，保留標題、段落、條列與表格。
5. 流程圖、架構圖：依順序寫出每個步驟或元件，以及它們之間的關係。
6. 照片：一句話描述與簡報主題相關的內容。
7. Logo、背景、裝飾圖示：kind 填 decoration，content 填空字串。
8. 只寫出圖片中看得到的內容，不要推測、補充或下結論；看不清楚的字或數字寫「（無法辨識）」，不要猜。
9. 不要重複本頁文字已經寫出的內容。
10. 使用圖片中的原文語言，不要翻譯。
"""


def slide_prompt(slide: SourcePage, count: int) -> str:
    context = slide.text()[:MAX_CONTEXT_CHARS] or "（本頁沒有文字）"
    return (f"第 {slide.number} 頁的文字（參考用，幫助你判斷圖片的內容）：\n{context}\n\n"
            f"本頁共有 {count} 張圖片，依序附上。")


# call(system_instruction, prompt, images=[(bytes, mime)], usage) → 符合 SlideImageReadings 的 dict
VisionCall = Callable[[str, str, list[tuple[bytes, str]], dict], dict]


def read_slide_images(slides: list[SourcePage], call: VisionCall, usages: list[dict]) -> tuple[dict[str, str], list[str]]:
    """逐頁辨識圖片，回傳 ({圖片 key: 文字}, 提示訊息)。單頁失敗不影響其他頁，失敗的圖片標為未辨識。
    每次呼叫的 token 用量附加到 usages（由呼叫端加總記錄）。"""
    limit = image_limit()
    jobs, total, notices = [], 0, []
    for slide in slides:
        images = slide.images
        if limit and total + len(images) > limit:
            images = images[:max(0, limit - total)]
        if images:
            jobs.append((slide, images))
            total += len(images)
    skipped = sum(len(s.images) for s in slides) - total
    if skipped:
        notices.append(f"超過辨識上限（{limit} 張），{skipped} 張圖片未辨識")

    def run(job):
        slide, images = job
        usage = {}
        usages.append(usage)
        data = call(SYSTEM_INSTRUCTION, slide_prompt(slide, len(images)), [(img.data, img.mime) for img in images], usage)
        readings = data.get("images") or []
        out = {}
        for img, r in zip(images, readings):
            kind = str(r.get("kind") or "").strip().lower()
            out[img.key] = "" if kind == "decoration" else str(r.get("content") or "").strip()
        return out

    results, failed, errors = {}, 0, []
    with ThreadPoolExecutor(max_workers=concurrency()) as pool:
        futures = [(job, pool.submit(run, job)) for job in jobs]
        for (slide, images), future in futures:
            try:
                results.update(future.result())
            except Exception as e:                 # 單頁失敗（例如模型不支援圖片）時其餘頁面照常
                failed += len(images)
                errors.append(str(getattr(e, "detail", None) or e))
    if failed:
        reason = f"：{errors[0][:120]}" if errors else ""
        notices.append(f"{failed} 張圖片辨識失敗，已標示為「未辨識」{reason}")
    return results, notices
