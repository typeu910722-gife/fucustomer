# Google 登入（高級社畜證照）

## 現在做到哪裡
- 遊戲主選單有「高級社畜證照」：頭像、名字、等級、職級、星數、成就。**沒登入時只存在這台裝置。**
- 用 Google 登入後會拿到一組**證號**（例如 `1234-5678`），等級等資料會同步到遊戲伺服器，好友在「🔍 查好友證照」輸入證號就能看到你的證照。
- 伺服器只保存 Google 帳號 ID 的雜湊值（SHA-256），**不保存 email**；公開的證照只有名字、頭像、等級、職級、星數、成就數、店名、一句話。
- 驗證方式：Google 傳回的登入憑證（ID token）用 Google 公開的金鑰檢查簽章、對象（client ID）、發行者、到期時間。**不需要任何密鑰**，所以沒有東西要藏。
- 測試：`tests/auth.test.ts` 用自己產生的金鑰模擬 Google，確認偽造、過期、給別的遊戲用的憑證都會被拒絕。**還沒有用真的 Google 帳號測試過**（需要你先建立用戶端 ID）。

## 需要你做的事（免費）
Google 登入要一組「OAuth 用戶端 ID」，這要用**你自己的 Google 帳號**建立，我沒辦法代辦：

1. 打開 https://console.cloud.google.com/ ，建立一個專案（例如「fucustomer」）。
2. 左側「API 和服務」→「OAuth 同意畫面」：使用者類型選「外部」，填應用程式名稱（奧客退散）、支援 email。範圍只要預設的（email、profile、openid）。
3. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選「網頁應用程式」。
4. 「已授權的 JavaScript 來源」加上遊戲網址，例如：
   - `https://fucustomer.yzprojecttw.com`（正式網站，之後新版上線時）
   - `http://localhost:8787`（本機測試）
5. 建立後會看到「用戶端 ID」（長得像 `1234567890-xxxx.apps.googleusercontent.com`）。**這組不是密鑰**，可以公開。
6. 把它設定在遊戲伺服器的環境變數 `GOOGLE_CLIENT_ID`（本機：`GOOGLE_CLIENT_ID=... npm start`）。之後換成 Cloudflare 版伺服器時，設定在 `wrangler.jsonc` 的 `vars`。

費用：Google 登入本身免費。以官方說明為準：https://developers.google.com/identity/gsi/web/guides/overview

## App 裡怎麼登入：「用瀏覽器登入」（2026-10-20 新增）
Google 不允許在 App 內嵌的網頁（Android／iOS WebView）裡登入，會直接擋掉。所以 App 裡的登入按鈕改成「🌐 用瀏覽器登入 Google」：

1. App 呼叫 `POST /api/auth/link/start` → 伺服器回 `{ code: "K7Q-4MZ", pollToken: <64 位十六進位>, expiresIn: 600 }`。
2. App 用系統瀏覽器（`@capacitor/browser`，Android 是 Custom Tab、iOS 是 Safari 視窗）打開 `https://fucustomer.yzprojecttw.com/beta/#link=K7Q-4MZ`，畫面顯示代碼和「⏳ 等待瀏覽器登入…」，每 2.5 秒問一次 `POST /api/auth/link/poll { pollToken }`（回到 App 時也會馬上問一次）。
3. 網頁看到 `#link=代碼` 就跳出「📲 把登入帶回 App」：沒登入就先用 Google 登入，登入後按「✅ 帶回 App」→ `POST /api/auth/link/complete { code }`（帶 `x-session`）。伺服器替這張證照**另外發一組新的登入**（不是把瀏覽器那組給出去），算在「最多 5 台裝置」裡。網頁顯示「✅ 完成，回到 App 吧」。
4. App 下一次 poll 拿到 `{ no, session, card }`（只給一次），這筆連結紀錄就刪掉。

安全上的設計：
- **只有代碼拿不到登入。** 要拿到 session 必須有 pollToken，而 pollToken 只存在 App 裡、從不放進網址或畫面。伺服器只存 pollToken 的 SHA-256，比對時用固定時間比較。
- 代碼 6 碼（不含容易看錯的 0/O/1/I/L），10 分鐘過期、只能用一次；過期時如果網頁已經完成、App 卻沒來拿，那組新登入會一起作廢。
- 每個 IP 10 分鐘內最多開始 10 次（另外還有原本每分鐘 120 次的 API 上限）。
- 防釣魚：網頁會提醒「請確認 App 上顯示的是同一組代碼，只有你自己剛從 App 按登入時才繼續」，而且一定要按「帶回 App」才會送出，不會自動完成。
- 網頁只會對**自己的網站伺服器**送出請求（不接受網址裡指定別的伺服器），所以 App 和網頁必須連到同一台遊戲伺服器；App 的伺服器設定若改成別台，就得用那台伺服器的網頁登入。
- Node 版（`server/auth.ts` `LicenseRegistry`，連結紀錄只放記憶體）和 Cloudflare 版（`LicenseDO` 的 `links` 表，加上 alarm 定時清掉過期的）規則相同、API 相同。

測試：`tests/auth.test.ts`（開始／完成／領取、過期、只能用一次、錯的 token、IP 上限、5 台上限）、`tests/net.test.ts`（Node 伺服器 HTTP）、`tests/cf.test.mjs`（本機 wrangler 跑 Worker + Durable Object）。瀏覽器模擬：同一台電腦用 Playwright 開兩個分頁，一個假裝是 App（`window.Capacitor` 假物件），一個是網頁；網頁那邊的「完成」呼叫是假資料（這裡沒有真的 Google 帳號）。**還沒在真的 Android 手機上、用真的 Google 帳號測過。**

## 還沒做
- 真機測試「用瀏覽器登入」（Android App → Chrome Custom Tab → 回到 App）。
- Steam 桌面版：同樣可以改用這個「用瀏覽器登入」流程（目前只有 Capacitor App 會用）。
- 好友名單（現在是輸入證號查詢）。
