# 隱私權政策（草稿）／ Privacy Policy (draft)

> 草稿，上架前請確認內容與實際行為一致，並放在一個公開網址（Google Play 與 App Store 都要求提供隱私權政策網址）。
> 最後更新：2026-10-19

## 中文

《奧客退散 FUCustomer》（以下稱「本遊戲」）重視你的隱私。

**單人遊戲**
- 本遊戲不要求註冊帳號，不收集姓名、電子郵件、電話、位置、聯絡人、照片或任何可識別個人的資料。
- 你的遊戲進度（職級、星星、設定、你自己輸入的暱稱）只儲存在你的裝置上，不會上傳。刪除 App 或清除資料即會刪除。
- 本遊戲不含廣告、不含第三方分析或追蹤工具。

**多人連線（選用）**
- 只有在你主動建立或加入房間時，才會連線到遊戲伺服器。
- 傳送的資料僅限遊戲運作所需：你輸入的暱稱、遊戲操作、店面合作進度，以及網路連線本身必然會帶的 IP 位址。
- 伺服器只為了讓斷線玩家能回到房間，暫存房間狀態最多 30 分鐘；不做其他用途，不出售、不分享給第三方。
- 多人模式只提供預設快捷訊息，沒有自由文字聊天。

**Steam 版**
- 若透過 Steam 遊玩，成就與好友邀請功能由 Steam 處理，適用 Valve 的隱私權政策。

**兒童**
- 本遊戲不會刻意收集任何人的個人資料，包括 13 歲以下兒童。

**聯絡方式**：（請填入你的聯絡信箱）

## English

FUCustomer ("the game") respects your privacy.

**Single-player**
- No account is required. The game does not collect your name, e-mail, phone number, location, contacts, photos or any other personally identifiable information.
- Your progress (rank, stars, settings and the nickname you type) is stored only on your device and is never uploaded. Uninstalling the app or clearing its data deletes it.
- The game contains no advertising and no third-party analytics or tracking.

**Online co-op (optional)**
- The game connects to a game server only when you create or join a room.
- Only data needed to play is sent: your nickname, your in-game actions, the shared store progress, and your IP address (inherent to any network connection).
- The server keeps room state for up to 30 minutes so disconnected players can rejoin. It is not used for anything else, sold, or shared.
- Co-op offers preset quick messages only; there is no free-text chat.

**Steam**
- When playing through Steam, achievements and friend invites are handled by Steam under Valve's privacy policy.

**Children**
- The game does not knowingly collect personal information from anyone, including children under 13.

**Contact**: (your e-mail here)


## Google 登入（選用，2026-10-20 新增）
- 只有你按下「用 Google 登入」才會使用。登入後伺服器保存：Google 帳號 ID 的雜湊值（無法反推回帳號）、你的證號、證照上顯示的資料（名字、頭像、等級、職級、星數、成就數、店名、一句話）。
- **不保存** email、電話、生日或 Google 帳號的其他資料。
- 證照資料是公開的：知道你證號的人都看得到。
- 在 App 裡用「用瀏覽器登入」時，伺服器會暫存一組 6 碼連結代碼、App 專用暗碼的雜湊值，以及登入完成後要交給 App 的那組登入，**最多 10 分鐘**；App 領走或過期就刪除。
- 按「登出」會讓這台裝置的登入失效。要刪除證照資料可以聯絡開發者（正式上線前會加刪除按鈕）。

## 雲端備份（選用，需要 Google 登入，2026-10-20 新增）
- **什麼資料**：只有玩家按「☁ 上傳到雲端」或自己打開「自動上傳」（預設關閉）時，才上傳遊戲進度存檔（內容同存檔碼：職級、星星、薪資點數、成就、外觀道具、各店面存檔、設定、暱稱、頭像），以及上傳時間與摘要（等級、星數…）。
- **不包含**：email、Google 登入 session、多人重連 token、自訂伺服器網址、付費擴充包紀錄（伺服器會重新編碼存檔，把這些拿掉）。
- **存在哪裡**：遊戲伺服器（Cloudflare Workers／Durable Objects 的 LicenseDO；Node 自架版是 `data/cloudsaves/`），以 Google 帳號 ID 的 SHA-256 雜湊為索引，跟證照放在一起。只有登入同一帳號的裝置能讀；公開證照不顯示。
- **保存多久**：每帳號只留最新一份＋前一份；365 天沒有上傳自動刪除。
- **怎麼刪除**：遊戲內「設定 → 存檔備份 → 刪除雲端存檔」（按兩次）立即刪除；或聯絡開發者。刪除不影響裝置上的進度。
- 細節與免費方案用量評估見 `docs/CLOUD-SAVE.md`。

## Cloud save (optional, Google sign-in only — added 2026-10-20)
- **What**: only when the player presses "Upload to cloud" or turns on auto-upload (off by default): the game progress (same content as a save code) plus the upload time and a short summary.
- **Not included**: e-mail, Google sign-in session, multiplayer rejoin token, custom server URL, paid expansion entitlements (the server re-encodes the save without them).
- **Where**: the game server (Cloudflare Workers / Durable Objects), keyed by a SHA-256 hash of the Google account ID, next to the licence card. Readable only by devices signed in to the same account; never on the public card.
- **How long**: newest copy + the previous one; deleted automatically after 365 days without an upload.
- **How to delete**: in game, Settings → Save backup → "Delete cloud save" (press twice), or contact the developer. Deleting it does not affect the progress on the device.
