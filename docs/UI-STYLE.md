# 介面風格（第 13 輪）

- 方向：卡通遊戲風。奶油色面板、深紫粗外框、可以「按下去」的立體按鈕（底下 5px 陰影，按下時往下沉）、斜紋背景。
- 橫向優先：主選單左邊標題／右邊選單；職涯畫面左邊職級與分頁、右邊內容。手機直拿會出現「請轉橫向」畫面。高度 520px 以下（手機橫拿）自動縮小間距。
- 字型：justfont「粉圓」（SIL Open Font License 1.1，可商用，授權檔 `client/public/fonts/OFL-huninn.txt`）。只保留遊戲用到的約 1,080 個字（205 KB）。**新增文字後要跑** `python3 scripts/font-subset.py`；`tests/font.test.ts` 會檢查有沒有漏字。
- 顏色變數都在 `client/index.html` 的 `:root`：`--ink` 外框、`--cream` 面板、`--accent` 主要按鈕（紅）、`--good` 綠、`--warn` 黃、`--info` 藍。
- 按鈕樣式：`.btn`（白）、`.btn.primary`（紅）、`.btn.good`（綠）、`.btn.warn`（黃）、`.btn.info`（藍）、`.btn.purple`、`.btn.small`、`.btn.hero`（大）。
