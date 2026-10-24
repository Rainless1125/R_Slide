# 前端元件

這些檔案由 R Slide 的伺服器直接提供，不從 CDN 載入，讓不能連外網的內網也能使用。
檔案內容與下列來源相同，沒有修改。

| 檔案 | 元件與版本 | 來源 | 授權 |
|------|-----------|------|------|
| `tailwindcss-3.4.17.js` | Tailwind CSS 3.4.17（瀏覽器版） | https://cdn.tailwindcss.com/3.4.17 | MIT |
| `fontawesome-6.5.1/css/all.min.css` | Font Awesome Free 6.5.1 | https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css | 程式碼 MIT、圖示 CC BY 4.0、字型 SIL OFL 1.1 |
| `fontawesome-6.5.1/webfonts/*.woff2` | Font Awesome Free 6.5.1 字型 | https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/ | SIL OFL 1.1 |
| `html-to-image-1.11.11.min.js` | html-to-image 1.11.11 | https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js | MIT |
| `jspdf-2.5.1.umd.min.js` | jsPDF 2.5.1 | https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js | MIT |

說明：

- Font Awesome 只包含 woff2 字型。CSS 中的 ttf 備用路徑不會被現代瀏覽器使用。
- 升級方法在 [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) 的「前端元件」。
