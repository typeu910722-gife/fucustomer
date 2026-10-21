# 雲端備份（Cloud Save）設計與免費方案評估

> 最後更新：2026-10-20。本文件的 Cloudflare 數字是 2026-10-20 從 Cloudflare 官方文件查到的，**一切以官方為準**，Cloudflare 隨時可能調整方案內容。
> 遊戲伺服器跑在使用者的 **Cloudflare Workers 免費方案**（`fucustomer-game.typeu910722.workers.dev`），不使用任何付費服務。

## 1. 功能摘要

- **選用**、只給 **Google 登入** 的玩家用。沒登入的玩家照舊用「存檔碼」備份（不需要帳號）。
- 每個證照（Google 帳號）**一個雲端欄位**：保存「最新一份」＋「前一份」存檔，各附上傳時間與摘要（等級、星數、薪資點數…）。
- 存的內容就是現有的存檔碼格式（`FUC1-…`，見 `shared/savecode.ts`）。伺服器會先用 `parseSaveCode` 嚴格驗證，**再重新編碼後才存**（不存使用者上傳的原文），所以雲端那份不可能夾帶：付費擴充包權利（entitlements）、Google 登入 session、多人重連 token、自訂伺服器網址。
- 還原時跟貼上存檔碼一樣走 `applySave()`：只覆蓋進度，保留這台裝置的 Google 登入與「這台裝置自己」已購買的擴充包，**不會因為雲端還原而多出任何付費內容**。
- 自動上傳預設 **關閉**；開啟後在每天打烊存檔後上傳，**最多每 10 分鐘一次**，失敗就安靜略過（本機存檔完全不受影響）。

API（Node 版 `server/index.ts` 與 Cloudflare 版 `cloudflare/src/worker.ts` 相同）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| `PUT` | `/api/cloudsave` | header `x-session`；body `{ "code": "FUC1-…" }`（≤ 72 KB）→ `{ at, size, summary, used, max }` |
| `GET` | `/api/cloudsave` | header `x-session` → `{ latest, prev, quota }`（含兩份存檔碼）；沒有存檔回 404 |
| `DELETE` | `/api/cloudsave` | header `x-session` → `{ deleted }` |

錯誤碼：401 沒登入／登入過期、400 存檔碼不合法、413 太大、429 太頻繁或今天次數用完、503 伺服器今天的雲端額度用完或空間滿了。前端遇到任何錯誤都只顯示友善訊息，本機進度不動。

## 2. Cloudflare Workers 免費方案：相關限制（以官方為準）

| 項目 | 免費方案 | 來源 |
|---|---|---|
| Worker 請求數 | **100,000 次／天**，00:00 UTC（台灣早上 8 點）重置；超過回 Error 1027 | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)、[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker CPU 時間 | **10 ms／每個 HTTP 請求**（等待網路、DO 呼叫不算 CPU） | [Workers Limits › CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| Worker 記憶體 | 128 MB | 同上 |
| 請求 body 大小 | 依 Cloudflare 帳號方案，Free 為 100 MB（我們自己限 72 KB） | 同上 › Request and response limits |
| Durable Objects 可用性 | 免費方案**只能用 SQLite-backed Durable Objects**（本專案 `wrangler.jsonc` 已是 `new_sqlite_classes`） | [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO 請求數 | **100,000 次／天**（HTTP、RPC 呼叫、WebSocket 訊息、alarm 都算；每次 RPC 方法呼叫算 1 次） | [DO Pricing › Compute billing](https://developers.cloudflare.com/durable-objects/platform/pricing/#compute-billing) |
| DO 執行時間 | **13,000 GB-s／天** | 同上 |
| SQLite 讀取列數 | **5,000,000 列／天** | [DO Pricing › SQLite storage backend](https://developers.cloudflare.com/durable-objects/platform/pricing/#sqlite-storage-backend) |
| SQLite 寫入列數 | **100,000 列／天**（刪除也算寫入；有索引的欄位被改到會多算一列） | 同上；[Workers Pricing › D1](https://developers.cloudflare.com/workers/platform/pricing/) |
| SQLite 儲存量 | **整個帳號共 5 GB** | 同上 |
| 單一 DO 儲存上限 | SQLite DO 官方公告 GA 時為每個物件 10 GB（免費方案仍受上面帳號 5 GB 總量限制） | [SQLite in DO GA 公告](https://developers.cloudflare.com/changelog/post/2025-04-07-sqlite-in-durable-objects-ga/) |
| 單列／字串大小、SQL 長度 | 官方限制表見 [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)。本次查詢工具沒有抓到那張表的原文；印象中單一字串／BLOB／列上限約 2 MB、SQL 語句約 100 KB，**未逐字確認，以官方為準**。我們一列最多約 140 KB（兩份 ≤ 64 KB 的存檔＋摘要），且存檔是用參數綁定（不是拼進 SQL 字串），離這些上限都很遠。 | |
| 超量時 | 免費方案任何一項超過，**該類操作直接失敗（回錯誤）**，不會自動收費 | [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

> 注意：遊戲房間（RoomDO）的 WebSocket 訊息也算 DO 請求，**多人連線才是免費額度的主要用量**。雲端備份必須只佔一小部分，所以下面的上限刻意設得很保守。

## 3. 選定的上限（`shared/cloudsave.ts`）

| 上限 | 數值 | 理由 |
|---|---|---|
| 每帳號欄位數 | 1（最新＋前一份） | 夠用來「換裝置」和「救回上一份」；儲存量可預估 |
| 單份存檔大小 | 重新編碼後 ≤ **64 KB**；request body ≤ 72 KB | 實測一般存檔約 11 KB（21 張地圖都有自由營業存檔時），所有欄位都有上限，64 KB 綽綽有餘 |
| 每帳號每天上傳 | **20 次**（UTC 日，跟 Cloudflare 一起在台灣早上 8 點重置） | 手動＋自動都算 |
| 同帳號兩次上傳間隔 | ≥ **60 秒**（伺服器擋）；遊戲自動上傳 ≥ **10 分鐘** | 防連點、防程式錯誤狂傳 |
| 全伺服器每天雲端請求 | **15,000 次**（上傳＋下載＋刪除合計），超過回 **503** | 讓雲端備份最多只吃掉 DO 請求額度的 15%，把額度留給多人連線 |
| 全伺服器欄位數 | **20,000 個**，滿了新帳號回 503 | 最壞 20,000 × 2 × 64 KB ≈ 2.6 GB < 5 GB |
| 保存期限 | 最後一次上傳後 **365 天**，之後自動刪除（每天第一次上傳時順便清） | 不讓沒人用的資料一直佔空間 |

全伺服器的每日計數放在 DO 記憶體，每 25 次寫一次 `meta` 表（DO 被回收最多少算 25 次）；Worker 一旦收到「今天額度用完」，同一個 isolate 當天直接回 503，不再叫醒 DO。

## 4. 為什麼放在 LicenseDO（而不是另開一個 DO）

- 每個雲端請求都要先把 `x-session` 換成證照擁有者，而 session 表本來就在 `LicenseDO`。放同一個物件 → **每個操作只要 1 次 DO 請求**；另開「以證號為 key 的 SaveDO」每次要 2 次（先問 LicenseDO 驗證，再找 SaveDO），在免費方案最缺的「DO 請求數」上直接翻倍。
- 存檔放在獨立的 `cloudsaves` 表（`owner` 主鍵、`updated` 索引、`data` JSON），平常讀證照不會讀到它。
- 缺點：所有雲端存檔都在同一個 DO（單執行緒）。以上面每天最多 15,000 次的上限，平均每秒不到 1 次，一個物件綽綽有餘；真的變熱門時可以再拆成以 owner 分片的 SaveDO（屆時要評估是否需要付費方案，**會先問使用者**）。
- Node 版（自架／本機測試）用 `server/cloudsave.ts`，資料放在 `data/cloudsaves/<owner>.json`，規則共用 `shared/cloudsave.ts`。

## 5. 用量估算

每次上傳 ≈ 1 個 Worker 請求 + 1 個 DO 請求 + 約 2 列寫入（存檔列＋`updated` 索引）+ 約 3 列讀取。下載／刪除 ≈ 1 + 1，讀取 2–3 列。

| 情境 | 上傳／天 | Worker 請求 | DO 請求 | 寫入列 | 儲存量 |
|---|---|---|---|---|---|
| 早期：200 位登入玩家，一半開自動上傳，每天玩 1 小時（≤ 6 次自動＋1 次手動） | ≈ 800 | ≈ 900（0.9%） | ≈ 900（0.9%） | ≈ 1,700（1.7%） | 200 × 2 × ~15 KB ≈ 6 MB |
| 成長：2,000 位，同樣比例 | ≈ 8,000 | ≈ 9,000（9%） | ≈ 9,000（9%） | ≈ 17,000（17%） | ≈ 60 MB |
| 最壞：大家都狂按 | 被全伺服器上限擋在 15,000 次 | ≤ 15%（+ 被擋的 503） | ≤ 15% | ≤ ~31% | ≤ 2.6 GB |

（括號是佔免費每日額度的比例。CPU：驗證＋重新編碼一份 ~11 KB 的存檔，本機 Node 暖機後實測約 0.65 ms；冷啟動會慢一些。10 ms 的限制看起來很寬，但**沒有在 Cloudflare 正式環境實測**。）

結論：早期玩家規模（幾百到一兩千人登入）離免費額度很遠；真的超過時伺服器回 503/429，遊戲照常存在本機，不會壞，也不會產生費用。

## 6. 測試（誠實標示）

- `tests/auth.test.ts`：Node 版規則（要登入、大小上限、間隔與每日次數、全伺服器額度、欄位上限、版本保留、entitlements 不會進雲端、刪除、一年未上傳自動刪除）。
- `tests/net.test.ts`：Node 伺服器 HTTP 層（CORS、401、413、上傳／下載、**重啟後還在**、刪除）。登入用預先寫入的證照檔模擬（真正的 Google 驗證另有單元測試）。
- `tests/cf.test.mjs`：Cloudflare 版在**本機 wrangler dev（Miniflare）**跑同樣流程；**不是**在 Cloudflare 正式網路上測，正式環境的 CPU／請求限制本機不會強制。
- `tests/e2e/round27c.mjs`：瀏覽器（同一台電腦）上傳 → 清空 localStorage → 從雲端還原。
