# 階段總結（2026-10-21，第 29 輪後暫停）

> 使用者要求：第 29 輪測試跑完後做階段收尾，剩下的下禮拜再做。下次說「繼續」就從本文件的「下禮拜待辦」開始。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 正式網址 https://fucustomer.yzprojecttw.com | 最新、完整測試通過的版本（舊 v0.4 保留在 `/v04/`） |
| 測試版 https://fucustomer.yzprojecttw.com/beta/ | 同一份建置＋安裝頁、iPhone 描述檔、Android APK |
| 多人／登入／雲端存檔伺服器 | Cloudflare Workers `fucustomer-game`（免費方案），推送開發分支自動部署 |
| Google 登入 | 已設定用戶端 ID；網頁直接登入，App／iPhone 主畫面版用「用瀏覽器登入」代碼流程 |
| 開發分支 | `claude/trusting-planck-eb99wg`（main 只放網站建置，不合併開發分支） |

## 遊戲內容（摘要）

- 主線第 1–10 章、奧客之王、無限夜班；常客奧客故事線 4 位×4 段。
- 21 種店、30 多種奧客（含各店招牌奧客與 4 種通用新奧客）、圖鑑與處理後小劇情。
- 每日挑戰、每週挑戰（變化＋週章）、特殊營業日（颱風夜、跨年夜）。
- 自由營業（店面等級 1–10、升級）、自己開店（員工小陳、連鎖分店最多 3 間、我的紀錄）。
- 多人 1–5 人：房號／邀請連結／LINE 分享、電腦店員補位、快捷訊息輪盤、斷線重連、房主工具。
- 法庭／警察局（含監視器證據）、外觀商城（付款功能準備中，不收錢）。
- 手把（Xbox／PS／Steam Deck）、觸控、PC 設定、無障礙（色盲配色、字級、音效字幕）。
- 存檔備份碼＋雲端存檔（登入後）。

## 測試與驗證（誠實分類）

- **自動測試**：規則 244 項、網路 21、Cloudflare 本機 20、瀏覽器 e2e 約 37 組、21 張地圖、桌面版殼；另有亂按測試 `npm run test:monkey`。詳見 `docs/TEST-LOG.md`（第 4–29 輪）。
- **模擬玩家**：難度平衡六輪（`docs/BALANCE.md`），數字來自機器人，不是真人。
- **沒有做過的實機測試**：真 iPhone、真 Android 手機、真手把、Steam Deck、Windows 實機、真人 Google 帳號登入／雲端存檔、跨裝置多人、音效人耳試聽。

## 需要你（使用者）做的事

1. **試玩與回饋**：音效示範帶 `docs/audio-reel.ogg`、iPhone 描述檔重裝後用瀏覽器登入 Google、新手第一天的手感、多人找朋友試。
2. **上架（之後再研究）**：
   - Google Play：開發者帳號（一次 US$25，以官方為準）；做到一半的準備存在 `docs/wip/`。
   - Steam：Steamworks（US$100，以官方為準）；全部準備在 `docs/STEAM.md`、`steam/`、`store/steam/`，拿到 App ID 填 `desktop/steam.config.json`。
3. **金流（網頁版）**：註冊綠界會員後，先用測試環境串接（說明見對話紀錄與 `docs/MONETIZATION.md`）。

## 下次待辦（第 30–32 輪已做完第 1、3 項與常客故事線；第 32 輪後暫停）

0. 第 33 輪預定：新特殊營業日「演唱會散場夜」（散場人潮、螢光棒掉滿地、追星奧客），沿用颱風夜／跨年夜架構，舊日期內容雜湊比對不變。


1. 第 29 輪留下的觀察項目：
   - 字級 130% 時手機訊息欄很擠（提示與按鈕優先，吐司會被收起）。
   - 找零小遊戲在手機 130% 會壓到左下拇指區。
   - round11（客製魔人）在高負載下偶發失敗，原因未查明（見 TEST-LOG 第 29 輪）；round27a 跨年夜時鐘檢查偶爾在準備階段就讀取。
   - 職涯畫面打開後似乎會再重畫一次（round29c 測試因此加了等待），要查是哪裡觸發的。
   - 2026-10-21 當天的每日挑戰（全是直播主＋停電）新手偏難；每日挑戰的手搖飲店沒有套店家規則。
2. 真人試玩後的回饋修正（最優先，有回饋就先做）。
3. `docs/QA-MONKEY.md` 未修項目整理、亂按測試再跑一輪。
4. 內容：更多特殊營業日、常客故事線、主線第 11 章？（待使用者決定方向）
5. 上架準備接續（Google Play 補完 `docs/wip/`、Steam 等 App ID）。新增成就後要跑 `ONLY=achievements/ node store/src/steam-art.mjs` 產生圖示、`npx tsx steam/achievements.ts` 更新成就清單（第 32 輪已更新到 39 個）。
6. 網頁版金流（綠界測試環境），需要使用者先註冊。

## 重要文件索引

`docs/TEST-LOG.md` 測試紀錄・`docs/BALANCE.md` 平衡・`docs/PERF.md` 效能・`docs/AUDIO.md` 音效・`docs/FTUE.md` 新手體驗・`docs/QA-MONKEY.md` 亂按測試・`docs/UI-STYLE.md` 介面規則・`docs/CLOUD-SAVE.md` 雲端存檔與免費額度・`docs/PRIVACY.md` 隱私・`docs/MONETIZATION.md` 營利・`docs/STEAM.md`／`docs/STORE-LISTING.md` 上架・`docs/PROGRESSION.md` 店面等級與分店・`CLAUDE.md` 給 Claude 的規則。
