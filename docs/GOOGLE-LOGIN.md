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

## 還沒做
- iOS／Android App 和 Steam 桌面版：Google 的網頁登入按鈕在 App 內不能直接用，之後要加原生登入外掛（App）或改用系統瀏覽器登入（桌面版）。
- Cloudflare 版伺服器的登入 API（目前只有本機 Node 伺服器有）。
- 好友名單（現在是輸入證號查詢）。
