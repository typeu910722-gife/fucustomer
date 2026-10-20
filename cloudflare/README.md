# 奧客退散：Cloudflare Workers + Durable Objects 版伺服器

狀態：**只在本機用 `wrangler dev` 測過（Miniflare/workerd，在這台電腦上模擬）。沒有建立 Cloudflare 帳號、沒有登入、沒有部署、沒有任何金鑰。**

這是 `server/index.ts`（Node 版）的 Cloudflare 版本。遊戲邏輯直接 import `shared/`，跟 Node 版是同一份程式碼；網址路徑也一樣，所以遊戲只要把伺服器網址指到 Worker 就能用。

## 架構

| 檔案 | 作用 |
|---|---|
| `src/worker.ts` | 入口：`/health`、`/ws`、`/api/room/:code`、`/api/stores/...`、`/api/auth/...`、`/api/license/...`，加上 CORS |
| `src/room-do.ts` | **一個房間 = 一個 Durable Object**（用 5 碼房間碼命名）。持有 `shared/room.ts` 的權威模擬、玩家連線、每秒 20 次的更新迴圈、檢查點 |
| `src/store-do.ts` | **一家好友的店 = 一個 Durable Object**（6 碼店碼）。規則同 `server/stores.ts`：店主憑證只存 SHA-256 雜湊、鎖門只能在門外搗亂、同一人 10 分鐘冷卻、分數上限、報告最多 20 筆 |
| `src/license-do.ts` | 高級社畜證照（Google 登入）。規則同 `server/auth.ts`：每個 Google 帳號一張證、8 碼證號、最多 5 台裝置同時登入、公開資料不含帳號與登入資訊 |
| `src/auth.ts` | Google ID token 驗證（WebCrypto 版），金鑰來源可替換，測試用自己產生的金鑰 |

### WebSocket 兩種接法

- **轉接模式（現在的遊戲不用改）**：遊戲連 `/ws` 之後才送 `create`/`join` 告訴伺服器要哪個房間，所以 Worker 先接住連線，等知道房間碼後再接到該房間的 Durable Object，兩邊互相轉送。
- **直連模式（建議之後改用）**：`/ws?create=1`（開新房）或 `/ws?room=房間碼`（加入／重連），Worker 直接把連線交給房間的 Durable Object，不經轉接。遊戲端只要在連線網址後面加這個參數（`client/src/net-ws.ts` 約 1 行），協定其他部分完全不變。

> ⚠️ 轉接模式的風險：Workers 免費方案每次呼叫只有 **10 ms CPU 時間**（[官方](https://developers.cloudflare.com/workers/platform/limits/)）。一條長時間的轉接連線會不會累積超過，本機測不出來（本機不限制 CPU）。官方也建議 WebSocket 交給 Durable Object 處理而不是 Worker 本身（[官方](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)）。**正式上線前建議把遊戲改成直連模式**，或部署後實測轉接模式。

### 為什麼房間不用「休眠 (Hibernation) API」

房間有人時，模擬必須每秒跑 20 次（客人走路、耐心下降、斷線保留計時），Durable Object 本來就不可能休眠；如果用休眠 API，執行環境反而可能在訊息之間把記憶體裡的遊戲世界清掉。所以用一般的 `accept()`：有玩家連著時房間留在記憶體，**房間沒人就停止迴圈、刪掉檢查點，物件被回收，不再計時收費**。休眠 API 只適合「大部分時間閒置」的連線（例如大廳聊天），之後若要做可以再加。

### 檢查點（存到 SQLite）

- 只在 **開店（開始營業）**、**日結**、以及 **成員有變動時最多每 60 秒一次** 寫入一筆（`cp` 這個 key 一列）。房間關閉時刪除（刪除也算一次寫入）。
- 一個房間玩一小時大約只寫十幾列，遠低於免費額度每天 10 萬列。
- Cloudflare 更新程式或執行環境時連線會斷；玩家用原房間碼＋重連憑證回來，會回到 **當天開店前** 的狀態（跟 Node 版重啟一樣）。檢查點超過 30 分鐘不用。

## 本機執行（不需要帳號）

```bash
cd cloudflare
npm install            # 只裝在 cloudflare/ 裡：wrangler、@cloudflare/workers-types
npx wrangler dev --local --ip 127.0.0.1 --port 8788
```

然後遊戲設定的「自訂伺服器」填 `ws://127.0.0.1:8788/ws`。

型別檢查（在專案根目錄）：`npx tsc --noEmit -p cloudflare`

測試（在專案根目錄，會自己啟動和關閉 wrangler dev）：

```bash
node --import tsx --test --test-concurrency=1 tests/cf.test.mjs
```

測試內容（**同一台電腦多開模擬玩家，不是跨裝置實機，也不是 Cloudflare 真實網路**）：健康檢查與 CORS；轉接模式開房／加入／移動同步；直連模式；找不到房間後同一條連線還能開房；5 人滿、第 6 人 `room_full`；斷線用憑證重連（同一角色、手上東西還在）；重複購買只扣一次；不同店型的房間並存＋`/api/room` 回傳店型與難度；好友店上傳／鎖門／搗亂／冷卻／報告；5 個機器人玩完整一天（時間 6 倍速，日結存檔送到每個人）；Google 登入驗證（自己產生的 RSA 金鑰代替 Google）；證照登入／更新／公開查詢／登出／最多 5 台裝置；**關掉 wrangler 再重開**後房間、好友店、證照都還在。

## 免費方案額度與費用風險（2026-10-20 查官方文件）

來源：
- Durable Objects 價格：https://developers.cloudflare.com/durable-objects/platform/pricing/
- Workers 限制：https://developers.cloudflare.com/workers/platform/limits/
- Workers 價格：https://developers.cloudflare.com/workers/platform/pricing/

| 項目 | Workers Free（免費） | 本遊戲怎麼用掉 |
|---|---|---|
| Worker 請求 | 每天 100,000 次 | 每次 API 呼叫、每條 WebSocket 連線 1 次；經過 Worker 的 WebSocket 訊息**不算** |
| Worker CPU | 每次呼叫 10 ms | API 都很輕；轉接模式見上面的風險說明 |
| DO 請求 | 每天 100,000 次 | 包含 HTTP、RPC、WebSocket 建立、**收到的** WebSocket 訊息（20 則算 1 次）；送出的訊息不算 |
| DO 執行時間 | 每天 13,000 GB-s | 每個物件以 128 MB 計，有玩家連著的房間整段時間都算 |
| SQLite 寫入 | 每天 100,000 列 | 檢查點、店、證照，每次變更約 1–3 列 |
| SQLite 讀取 | 每天 500 萬列 | 很少 |
| 儲存 | 共 5 GB | 每家店／每張證幾 KB |

**免費方案超過額度時，該類操作會直接失敗（不會自動扣款），每天 00:00 UTC（台灣早上 8 點）重置。**

粗估（每位玩家遊戲中每秒送約 15 次位置＋心跳）：
- DO 請求：每位玩家每秒約 15.3 則 ÷ 20 ≈ 0.77 次 → 每天約 **36 玩家小時**，也就是 5 人房約 **7 小時/天**（最先用完的就是這項）。
- DO 執行時間：13,000 ÷ 0.128 ≈ 101,000 秒 → 約 **28 房間小時/天**（不管幾個人）。
- 所以免費方案大概只夠朋友間小規模試玩；超過時新房間會連不上，直到隔天重置。

付費方案（Workers Paid，每月最低 US$5）：每月含 100 萬 DO 請求、40 萬 GB-s；超過後每百萬請求 US$0.15、每百萬 GB-s US$12.50。照上面的估法，超出含量後一間 5 人房玩 1 小時約 US$0.008（請求約 13,800 次 ≈ $0.002＋執行時間約 461 GB-s ≈ $0.006）。**價格會變，以官方頁面為準；要不要升級請你決定。**

省額度的做法（之後可做）：降低位置回報頻率或只在移動時送、快照改差量、改用直連模式、房間閒置（全員在選單）時降低更新頻率。

## 還沒做 / 限制

- **沒有部署、沒有在 Cloudflare 真實網路測過**：CPU、記憶體、每日額度在本機都不會被限制，數字只能部署後實測。
- 轉接模式在免費方案的 CPU 限制下是否穩定未知（見上）；遊戲端改直連要動 `client/`，這次沒動。
- 全伺服器房間上限（Node 版 `MAX_ROOMS`）、好友店總數上限（5000）沒有做：Durable Objects 是分散的，要做需要再加一個計數用的物件。
- 每個 IP 每分鐘 120 次 API 的限制只在單一 Worker 執行個體內有效（Cloudflare 會開很多個），部署後建議改用 Cloudflare 的 Rate Limiting 或 WAF 規則。
- 證照全部放在同一個 Durable Object（因為要用登入憑證反查是誰），量很大時要再拆。
- 搗亂分數仍由玩家端回報（跟 Node 版一樣是原型規則）。

## 之後要部署時，你需要自己做的事

1. 用你自己的 Email 註冊 Cloudflare 帳號（網站已在 Cloudflare Pages 的話用同一個帳號）。
2. 在這個資料夾：`npx wrangler login`（瀏覽器登入授權，不會把金鑰寫進專案）。
3. （要開 Google 登入的話）把 `wrangler.jsonc` 的 `GOOGLE_CLIENT_ID` 填上你的 Google OAuth 網頁用戶端 ID（這是公開的 ID，不是密鑰）。**不要設定 `GOOGLE_CERTS_URL`**（只給測試用，而且只接受本機網址）。
4. `npx wrangler deploy`，會得到 `https://fucustomer-game.<你的子網域>.workers.dev`（也可以在後台綁自己的網域）。
5. 遊戲的伺服器網址設成 `wss://fucustomer-game.<你的子網域>.workers.dev/ws`（建置時 `VITE_SERVER_URL`，或遊戲設定的「自訂伺服器」）。
6. 到 Cloudflare 後台看 Workers / Durable Objects 的用量，確認在免費額度內。
