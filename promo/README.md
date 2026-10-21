# R Slide 介紹短影片

`r_slide_showreel_v2.mp4`：30 秒、1920×1080、60fps，面向使用者的產品介紹（不含後台）。

| 時間 | 章節 |
|------|------|
| 0:00 | 片頭 |
| 0:02 | 01 輸入：貼上文字或匯入檔案、簡易／詳細模式 |
| 0:06 | 02 內容導向版型 |
| 0:09 | 03 圖表與數據表格 |
| 0:12 | 04 插入圖示／圖案、拖曳對齊 |
| 0:16 | 05 十種風格一鍵換裝 |
| 0:19 | 06 單頁重產 |
| 0:22 | 07 講者備註與講者檢視 |
| 0:25 | 08 匯出 PDF / PPTX / HTML |
| 0:28 | 片尾 |

## 重新產生

動畫寫在 `showreel.html / .css / .js`，每一格都是時間的純函式，由 `render.js` 用 Playwright 逐格截圖、再交給 ffmpeg 編碼。

```bash
cd promo
npm install                        # Noto Sans TC 與 Font Awesome
NODE_PATH=$(npm root -g) node render.js                # 需全域安裝 playwright 與 ffmpeg
NODE_PATH=$(npm root -g) node render.js --stills 3,14  # 只輸出指定秒數的截圖
```
