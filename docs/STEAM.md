# 上架 Steam：照順序做的清單

> 更新：2026-10-20。這份是「你（開發者本人）要做的事」，照順序打勾即可。程式、建置、素材我這邊已經準備好（見最後「已經準備好的東西」）。
> 時間、費用、審核天數等規定**以 Steam 官方說明為準**，Valve 隨時可能調整；下面的數字是撰寫時官方頁面寫的，連結附在每一步。
> 官方入口：<https://partner.steamgames.com/>　說明文件總目錄：<https://partner.steamgames.com/doc/home>

## 誠實說明目前的狀態

- ✅ Windows 版（Electron 38，x64）在 Linux 雲端環境建出 `release/desktop/FUCustomer-0.9.0-win-x64.zip`（約 117 MB，解壓後約 286 MB，大部分是 Electron／Chromium 本體）。
- ⚠️ **沒有在真正的 Windows 電腦上開過**。同一份程式在 Linux 虛擬螢幕（xvfb）跑過自動化測試：遊戲能開、能進班次、桌面橋接正常。
- ⚠️ **Steam 整合沒有用真正的 Steam 客戶端測過**（沒有 App ID，這裡也沒有 Steam）。已驗證的是：steamworks.js 會被打包進去；沒有 App ID 時完全不啟動；有 App ID 但 Steam 沒開時會印出錯誤、遊戲照常可玩，不會當掉。
- ⚠️ 成就、好友「加入遊戲」、Steam 浮層（Shift+Tab）、雲端存檔都要等你拿到 App ID、在 Steam 裡實際開一次才算真正驗證。第 8 步有測試清單。

---

## 第 1 步：註冊 Steamworks 合作夥伴帳號（免費）

1. 用你的 Steam 帳號登入 <https://partner.steamgames.com/>，選「加入 Steamworks」。
   建議 Steam 帳號先開啟 **Steam Guard 手機驗證**（之後上傳、發版都會用到）。
2. 填公司／個人名稱（個人也可以，會顯示為「開發者」「發行商」；之後商店頁可以另外設定顯示名稱，例如 yzproject）。
3. 簽署 Steam 發行協議（Steam Distribution Agreement）——線上點選同意。

說明：<https://partner.steamgames.com/doc/gettingstarted>

## 第 2 步：付 Steam Direct 費用（每款遊戲 US$100）

- 在後台「建立新 App」時付款（信用卡等）。**這筆錢只能由你本人付**，我不會也無法代付。
- 這 US$100 在遊戲調整後總營收達到 US$1,000 之後會退還（以官方說明為準）。
- 付完就會拿到 **App ID**（一串數字）。

說明：<https://partner.steamgames.com/steamdirect>

## 第 3 步：身分、稅務、銀行資料

後台會要求你完成（可能要幾天審核，請盡早做）：

1. **身分驗證**（Identity verification）：上傳身分證件，可能需要視訊／照片驗證。
2. **稅務問卷**（Tax interview）：台灣個人一般填 **W-8BEN**（非美國個人）。台美之間的租稅協定適用情況以官方問卷與國稅局說明為準；不確定的話照實填、不要勾選你不確定的協定優惠。
3. **銀行資料**：收款帳戶（台灣銀行帳戶可以，需要 SWIFT code；外幣入帳手續費以你的銀行為準）。

說明：<https://partner.steamgames.com/doc/finance/taxfaq>、<https://partner.steamgames.com/doc/finance/payments_salesreporting>

## 第 4 步：記住這些強制等待期（以 Steam 官方說明為準）

| 規定 | 撰寫時官方說明 | 影響 |
|---|---|---|
| 付費後到可以發售 | 新開發者的頭幾款遊戲：**付 Steam Direct 費用後至少 30 天**才能發售 | 最快的發售日 = 付款日 + 30 天 |
| 「即將推出」頁面 | 商店頁要以「即將推出（Coming Soon）」公開**至少 2 週**，才能按發售 | 商店頁要越早送審越好 |
| 商店頁審核 | 送審後約 **1–5 天**（工作天，以官方為準） | 要通過才能公開「即將推出」 |
| 遊戲建置審核 | 送審後約 **1–5 天** | 要通過才能按發售 |

說明：<https://partner.steamgames.com/steamdirect>、<https://partner.steamgames.com/doc/store/review_process>、<https://partner.steamgames.com/doc/store/coming_soon>

**最快時程建議**：付款當天就把商店頁填好送審 → 審過立刻公開「即將推出」（開始累積願望清單）→ 同時上傳 Build 送審 → 第 30 天（且即將推出滿 2 週）之後按發售。

## 第 5 步：填 App ID（全專案只有一個地方）

打開 `desktop/steam.config.json`：

```json
{ "appId": 0, "depotId": 0, "includeStorePacks": false }
```

- `appId`：改成你的 App ID。
- `depotId`：留 0（預設 = App ID + 1）；後台 SteamPipe → Depots 顯示的不一樣才填。
- `includeStorePacks`：見第 10 步「定價」。

改完重新建置：`npm run desktop:win`。App ID 不是秘密，可以 commit；**Steam 帳號密碼、Steam Web API 金鑰**等才是秘密，永遠不要放進專案。

## 第 6 步：後台設定

### 6-1 成就（後台 → 應用程式管理 → 統計與成就 → 成就）

用「新增成就」逐一建立，**API 名稱必須完全相同**（大寫、底線）。完整清單也在 `steam/achievements.csv`（可用 Excel 開）。圖示在 `store/steam/achievements/`（256×256 PNG：彩色 = 已達成、灰色加鎖 = 未達成）。

| API 名稱 | 顯示名稱 | 說明 | 圖示（已達成／未達成） |
|---|---|---|---|
| `FIRST_SHIFT` | 第一天上班 | 完成第一個班次 | `FIRST_SHIFT.png` / `FIRST_SHIFT_locked.png` |
| `FIRST_THROW` | 請你出去 | 第一次把奧客丟出門 | `FIRST_THROW.png` / `FIRST_THROW_locked.png` |
| `CH1` | 試用期結束 | 通關第 1 章 | `CH1.png` / `CH1_locked.png` |
| `CH2` | 正職到手 | 通關第 2 章 | `CH2.png` / `CH2_locked.png` |
| `CH3` | 大夜班生存者 | 通關第 3 章 | `CH3.png` / `CH3_locked.png` |
| `CH4` | 店長候補 | 通關第 4 章 | `CH4.png` / `CH4_locked.png` |
| `CH5` | 區域督導 | 通關第 5 章 | `CH5.png` / `CH5_locked.png` |
| `BOSS` | 奧客剋星 | 擊敗奧客之王 | `BOSS.png` / `BOSS_locked.png` |
| `ATLAS` | 全台奧客圖鑑 | 通關第 10 章，見過每一種店的招牌奧客 | `ATLAS.png` / `ATLAS_locked.png` |
| `DEX_ALL` | 圖鑑全收集 | 每一種店的招牌奧客（17 種）都至少處理過一次 | `DEX_ALL.png` / `DEX_ALL_locked.png` |
| `LV10` | 熟練店員 | 職級達到 Lv10 | `LV10.png` / `LV10_locked.png` |
| `LV20` | 資深店員 | 職級達到 Lv20 | `LV20.png` / `LV20_locked.png` |
| `LV30` | 終極打工人 | 職級達到 Lv30 | `LV30.png` / `LV30_locked.png` |
| `KARENS_100` | 退散百人斬 | 累計處理 100 位奧客 | `KARENS_100.png` / `KARENS_100_locked.png` |
| `SERVED_1000` | 千人服務 | 累計服務 1000 位客人 | `SERVED_1000.png` / `SERVED_1000_locked.png` |
| `STARS_60` | 星星收藏家 | 累計取得 60 顆星 | `STARS_60.png` / `STARS_60_locked.png` |
| `PERFECT` | 完美班次 | 任一班次拿到 3 星 | `PERFECT.png` / `PERFECT_locked.png` |
| `COMBO_5` | 連送五人 | 一個班次內連續送走 5 位奧客 | `COMBO_5.png` / `COMBO_5_locked.png` |
| `ENDLESS_1600` | 夜班傳說 | 無限夜班拿到 1600 分 | `ENDLESS_1600.png` / `ENDLESS_1600_locked.png` |
| `ENDLESS_PLAYED` | 還沒下班 | 挑戰一次無限夜班 | `ENDLESS_PLAYED.png` / `ENDLESS_PLAYED_locked.png` |
| `DAILY_FIRST` | 今日任務 | 完成一次每日挑戰 | `DAILY_FIRST.png` / `DAILY_FIRST_locked.png` |
| `DAILY_STREAK_3` | 全勤獎 | 連續 3 天完成每日挑戰 | `DAILY_STREAK_3.png` / `DAILY_STREAK_3_locked.png` |

- 英文名稱／說明可在同一頁切換語言補上（可選）。
- 建好後要按頁面上的「**發佈變更**」（Publish）才會生效。
- 遊戲每次開啟時會把存檔裡已拿到的成就補報給 Steam，所以 Steam 版上架前就玩過的成就也會同步。
- 之後若新增成就：先在 `shared/achievements.ts` 加，再在 `store/src/steam-art.mjs` 的 `ACH` 加圖示，跑 `node store/src/steam-art.mjs` 和 `npx tsx steam/achievements.ts`。

### 6-2 好友「加入遊戲」（Rich Presence）

後台 → 社群 → Rich Presence：上傳 `steam/rich_presence_tchinese.vdf` 和 `steam/rich_presence_english.vdf`。
好友列表會顯示「正在顧店」或「多人房間 ABCDE」，好友按「加入遊戲」會用 `+join 房間碼` 開啟遊戲並自動進房（程式已寫好，未實測）。

### 6-3 Steam 雲端存檔（後台 → 應用程式管理 → Steam Cloud）

存檔在 Electron 的 localStorage。程式已把資料夾名稱固定為 `FUCustomer`（不會因為改版本或改商品名而變動，**上架後永遠不要改**）：
Windows 實際位置：`%APPDATA%\FUCustomer\Local Storage\leveldb\`

1. 「每位使用者位元組配額」填 `20000000`（20 MB）、「每位使用者檔案數」填 `100`。
2. 開啟 **Auto-Cloud**，新增一條「根路徑覆寫／路徑」：

| 欄位 | 值 |
|---|---|
| 根目錄（Root） | `WinAppDataRoaming` |
| 子目錄（Subdirectory） | `FUCustomer/Local Storage/leveldb` |
| 模式（Pattern） | `*` |
| 作業系統 | Windows |
| 遞迴 | 否 |

3. 儲存並發佈。說明：<https://partner.steamgames.com/doc/features/cloud>（Auto-Cloud 章節）

注意：這是同步整個 LevelDB 資料夾的做法（Electron 遊戲常見），遊戲關閉時才會上傳。兩台電腦同時玩可能出現 Steam 的「雲端衝突」選擇視窗。另外遊戲內已有「存檔碼」備份功能，可以當保險。**未實測**。

### 6-4 Steam 浮層（Shift+Tab）

程式在有 App ID 時會自動套用 steamworks.js 建議的 Electron 設定（`in-process-gpu`、`disable-direct-composition`、每幀重繪）。如果玩家回報畫面閃爍或黑屏，可在 Steam 啟動選項加 `--no-steam-overlay` 關掉這個設定（浮層會失效，但遊戲可玩）。**未實測**。

## 第 7 步：商店頁（後台 → 商店頁面管理）

所有文字在 `docs/STORE-LISTING.md`（Steam 簡短說明、完整說明的中英文、標籤、系統需求都已寫好）。圖片在 `store/steam/`：

| 後台欄位 | 尺寸 | 檔案 |
|---|---|---|
| 頁首膠囊（Header Capsule） | 920×430 | `store/steam/header_capsule_920x430.png` |
| 小型膠囊（Small Capsule） | 462×174 | `store/steam/small_capsule_462x174.png` |
| 主要膠囊（Main Capsule） | 1232×706 | `store/steam/main_capsule_1232x706.png` |
| 垂直膠囊（Vertical Capsule） | 748×896 | `store/steam/vertical_capsule_748x896.png` |
| 頁面背景（Page Background，選用） | 1438×810 | `store/steam/page_background_1438x810.png` |
| 截圖（至少 5 張，1920×1080） | 1920×1080 | `store/steam/screenshots/01-chicken.png` … `09-title.png`（共 9 張） |
| 收藏庫膠囊（Library Capsule） | 600×900 | `store/steam/library_capsule_600x900.png` |
| 收藏庫頁首（Library Header） | 920×430 | `store/steam/library_header_920x430.png` |
| 收藏庫主視覺（Library Hero，不可有文字） | 3840×1240 | `store/steam/library_hero_3840x1240.png` |
| 收藏庫標誌（Library Logo，透明 PNG） | 1280×720 | `store/steam/library_logo_1280x720.png` |
| 社群圖示（Community Icon） | 184×184 | `store/steam/community_icon_184x184.png` |
| 成就圖示 | 256×256 | `store/steam/achievements/*.png` |

- 尺寸是依官方「圖像素材」頁（<https://partner.steamgames.com/doc/store/assets>）撰寫時的規格。上傳時後台會檢查尺寸，若 Valve 又改規格，執行 `node store/src/steam-art.mjs` 改尺寸重出即可。
- 舊檔 `store/steam-header-460x215.png`、`store/steam-capsule-616x353.png` 是舊規格，**不要用**。
- 截圖是在無 GPU 的雲端環境用軟體繪圖拍的真實遊戲畫面（品質設「高」）。若你想要更好看的，可以在自己電腦上開遊戲按 F12（Steam 截圖鍵）補拍。
- 宣傳影片（Trailer）：非必填但強烈建議，我這邊沒有做。
- 「收藏庫標誌」上傳後，在後台預覽畫面拖曳它在主視覺上的位置。

### 內容調查問卷（Content Survey）建議答案

| 問題 | 建議回答 |
|---|---|
| 暴力 | 有，**卡通風格、喜劇式**：玩家可以把無理的顧客抓起來丟出店門、用拖把旋風推開；被丟的人跌倒後自己離開，**沒有血、沒有死亡、沒有傷口**。不是寫實暴力 |
| 血腥 | 無 |
| 性內容／裸露 | 無 |
| 成人內容 | 無；顧客會「生氣、大吼、拍片」，對白都是一般用語，無髒話 |
| 毒品／酒精／菸草 | 無（店裡賣的是飲料、零食、便當；若有啤酒類商品圖示請照實勾） |
| 賭博 | 無；**沒有轉蛋、沒有抽獎箱** |
| 使用者互動 | 多人模式：玩家暱稱＋預設快捷訊息，**沒有自由文字聊天、沒有語音** |
| 是否收集個人資料 | 單機不需要帳號；多人只傳暱稱與房間資料；選用 Google 登入只用來同步存檔（照 docs/PRIVACY.md 實際內容回答） |
| AI 生成內容揭露 | 照實揭露：程式碼、遊戲文字與商店宣傳圖是在 AI（Claude）協助下製作、由開發者審閱；**遊戲執行時不會即時產生 AI 內容**。（Steam 有專門的 AI 揭露欄位，必須照實填） |

### 年齡分級

- Steam 本身用上面的內容問卷決定是否需要年齡確認；本作預期**不需要年齡閘門**。
- 若後台提供 IARC 問卷（用於部分地區分級，例如德國 USK），照上表回答；預期結果約為 **PEGI 7／ESRB E10+／普遍級~保護級**（卡通暴力），**以問卷結果為準**。

## 第 8 步：上傳遊戲並自己測一次（重要）

1. 照 `steam/README.md` 用 steamcmd 上傳 Build，設到 `default`（或先設到有密碼的 `beta` 分支）。
2. 在你自己的 Windows 電腦用 Steam 安裝、從 Steam 開啟，逐項確認：
   - [ ] 遊戲能開、全螢幕正常（F11 切換、`--windowed` 視窗模式）
   - [ ] Shift+Tab 能開 Steam 浮層、沒有閃爍黑屏
   - [ ] 玩完第一班 → 跳出「第一天上班」成就
   - [ ] 開多人房間 → 朋友的好友列表顯示「多人房間 XXXXX」→ 朋友按「加入遊戲」能進房
   - [ ] 關遊戲 → Steam 顯示「正在同步雲端」→ 另一台電腦開啟有同一份存檔
   - [ ] 斷網時單機仍可玩
3. 有問題把畫面與 `%APPDATA%\FUCustomer\` 底下的狀況告訴我。
4. 後台「發行 → 檢查清單」全部打勾後按「送審建置」。

## 第 9 步：送審商店頁 → 公開「即將推出」

商店頁所有必填項目（膠囊圖、截圖、說明、系統需求、內容問卷、語言）填完 → 送審 → 通過後按「公開為即將推出」。之後每天都會累積願望清單。

## 第 10 步：定價（我的建議，最後由你決定）

**現況**：遊戲內商城的真錢購買**還沒有串接任何平台的金流**，所有付費按鈕都只顯示「付款功能準備中」。Steam 的微交易（Microtransactions API）需要另外寫伺服器端驗證，**目前沒做**。所以：

| 方案 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| **A. 買斷制（建議）** | 定價 US$4.99（Steam 會建議各地區價格，台灣約 NT$150 上下，以後台建議為準）；`desktop/steam.config.json` 設 `"includeStorePacks": true` | 現在就能完整上架；**10 種付費店面直接包含在售價裡**（已實作並測試：重建後自由營業可直接選電影院、火鍋等，不會出現 🔒）；不用串金流 | 「贊助者包」在 Steam 版仍顯示「準備中」（只有金色外觀，不影響遊玩） |
| B. 免費遊戲 | 售價免費，`includeStorePacks` 保持 `false` | 下載門檻低 | 10 種店面會顯示 🔒「準備中」卻買不到，玩家觀感差；Valve 對免費遊戲另有審核考量 |
| C. 免費＋DLC（之後再做） | 把兩個擴充包做成 Steam DLC（建 DLC 不用再付 US$100），程式用 steamworks.js 的 `isDlcInstalled` 判斷 | 比微交易簡單很多，不需要伺服器 | **尚未實作**，大約需要一輪開發＋你在後台建 DLC 商品 |

建議先用 **A** 上架；之後若想改免費，可以再做 C。注意：Steam 規定已經賣過錢的遊戲之後改免費是可以的，但反過來（免費改付費）通常不行（以官方說明為準）。

- 發售折扣：可以設首發折扣（例如 10%），規則見 <https://partner.steamgames.com/doc/marketing/discounts>。
- 地區價格用後台「建議價格」一鍵套用即可。

## 第 11 步：按下發售

條件全部滿足（付款滿 30 天、即將推出滿 2 週、商店頁與建置都審過）→ 後台「發行」頁按「發售」。

---

## 已經準備好的東西（給你對照）

| 項目 | 位置 |
|---|---|
| Steam 程式整合（成就、Rich Presence、+join、浮層設定、Steam 未開時安全略過） | `desktop/steam.cjs`、`desktop/main.cjs`、`desktop/preload.cjs` |
| App ID 設定（唯一一處） | `desktop/steam.config.json` |
| 桌面版建置（多人連線指向正式伺服器 `wss://fucustomer-game.typeu910722.workers.dev/ws`、關閉 QA 用的商城解鎖） | `desktop/build-web.cjs`、`npm run desktop:win` |
| 自動測試（Linux＋xvfb：沒有 App ID／有 App ID 但沒開 Steam 兩種情況） | `desktop/smoke.sh`、`tests/e2e/electron.mjs` |
| SteamPipe 上傳範本與填寫腳本 | `steam/` |
| 成就清單 CSV | `steam/achievements.csv` |
| 所有商店／收藏庫圖片、成就圖示、截圖 | `store/steam/`（重產：`node store/src/steam-art.mjs`、`node store/src/steam-screens.mjs`） |
| 商店頁文字、標籤、系統需求 | `docs/STORE-LISTING.md` |
