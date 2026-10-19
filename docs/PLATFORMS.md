# 各平台建置與上架準備

> 誠實標示：本文件記錄「建置得出來」的狀態。**沒有任何平台已上架**，也還沒在 iOS／Android／Windows 實機上試玩過。

| 平台 | 工具 | 目前狀態 |
|---|---|---|
| Android | Capacitor 7 → `android/` | ✅ 在 Linux 雲端容器建出**除錯版 APK**（約 10 MB）；未在實機或模擬器安裝測試（容器沒有 KVM，跑不了模擬器） |
| iOS | Capacitor 7 → `ios/` | ⚠️ 專案已產生並設定好；**必須在 macOS＋Xcode 建置**，本環境無法產出 |
| Windows（Steam） | Electron 38 → `desktop/` | ✅ 建出 Windows 免安裝 zip（約 130 MB，大部分是 Electron 本體）；同一份程式在 Linux 虛擬螢幕跑過自動化測試；未在 Windows 實機開啟 |
| 網頁 | Vite | ✅ 既有（PWA，可離線玩單機） |

## 需要你確認的設定

| 項目 | 目前值 | 位置 | 說明 |
|---|---|---|---|
| 套件 ID（Bundle ID） | `tw.yzproject.fucustomer` | `capacitor.config.json`、`desktop/package.json` | **上傳商店後永遠不能改**，請在第一次上傳前確認 |
| App 名稱 | 奧客退散（桌面版：FUCustomer） | 同上 | |
| 版本 | 0.6.0 | `desktop/package.json`、`android/app/build.gradle`（versionName） | Android 每次上傳 versionCode 要 +1 |
| 多人伺服器網址 | 未設定 | 建置時環境變數 `VITE_SERVER_URL=wss://你的網域/ws` | App 內沒有網頁伺服器，多人連線需要先架好公開伺服器（見 SERVER.md） |

## 需要你自己申請的帳號與費用

以下費用是撰寫時（2026 年）各平台公開的標準價格，**請以官方頁面為準**。我沒有、也不會替你註冊或付費。

| 平台 | 帳號 | 費用 | 誰要做 |
|---|---|---|---|
| Google Play | Google Play Console 開發者帳號 | 一次性 US$25；個人帳號新 App 需先找測試者做封閉測試一段時間才能正式上架 | 你：註冊、身分驗證 |
| App Store | Apple Developer Program | 每年 US$99 | 你：註冊；需要一台 Mac（或雲端 Mac 服務，另計費） |
| Steam | Steamworks（Steam Direct） | 每款遊戲 US$100（遊戲營收達 US$1,000 後退還） | 你：註冊、稅務資料、取得 App ID |
| Windows 程式碼簽章（選用） | 程式碼簽章憑證 | 每年約數百美元起 | 透過 Steam 發行可以不簽；直接在網路上發 exe 不簽會被 SmartScreen 警告 |
| 多人伺服器（選用） | 任一雲端主機 | 依供應商；見 SERVER.md | 只玩單機不需要 |

**密鑰與簽章檔絕對不要放進 git 或交付包**：Android 上架金鑰（.jks／.keystore）、Apple 憑證、Steam 帳密都只放在你自己的電腦或 CI 的 Secret 中。`.gitignore` 已排除常見檔名。

## Android

需求：JDK 21、Android SDK（platform 35、build-tools 35）。

```bash
npm install
npm run build:client            # 產生 dist/
npx cap sync android            # 複製 dist/ 與外掛到 android/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk（可直接裝到手機測試）
```

上架用（AAB，需你自己的上架金鑰）：

```bash
keytool -genkey -v -keystore ~/fucustomer-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file=$HOME/fucustomer-upload.jks \
  -Pandroid.injected.signing.store.password=*** \
  -Pandroid.injected.signing.key.alias=upload \
  -Pandroid.injected.signing.key.password=***
# → android/app/build/outputs/bundle/release/app-release.aab 上傳到 Play Console
```

已設定：橫向鎖定（`sensorLandscape`）、全螢幕隱藏狀態列與導覽列（邊緣滑動暫時顯示）、遊戲中螢幕不休眠、
返回鍵＝開暫停選單／退回上一層（主選單按返回＝離開 App）、切到背景自動暫停並顯示暫停選單。
注意：Android 預設禁止 `ws://`（未加密），正式多人伺服器必須用 `wss://`。

## iOS（需要 Mac）

```bash
npm install && npm run build:client && npx cap sync ios
npx cap open ios        # 開啟 Xcode
```

在 Xcode：選你的 Team（Apple Developer 帳號）→ Signing 自動管理 → 選實機或模擬器執行；上架用 Product → Archive → Distribute App。

已設定：只允許橫向、隱藏狀態列、全螢幕（不參與 iPad 分割畫面）、出口加密聲明（`ITSAppUsesNonExemptEncryption = NO`，只用標準 HTTPS/WSS）。

## Windows／Steam（Electron）

```bash
npm install && npm run build:client
cd desktop && npm install
npm start                 # 在本機開視窗測試（加 --windowed 不全螢幕）
npm run dist:win          # → release/desktop/FUCustomer-0.6.0-win-x64.zip（解壓即玩）
npm run dist:win-installer   # 安裝程式版（需在 Windows 上建，或 Linux 裝 wine）
```

在 Linux 上建 Windows 版時沒有寫入 exe 圖示與版本資訊（`signAndEditExecutable: false`，因為需要 wine）；
**正式版請在 Windows 上建置**，或把該設定改為 `true` 並安裝 wine。

桌面殼功能：預設全螢幕（F11 切換）、滑鼠鎖定（點畫面進入、Esc 開選單）、主選單有「離開遊戲」、
關閉視窗時把存檔寫入磁碟、外部連結一律封鎖、頁面拿不到 Node.js 權限（contextIsolation＋sandbox）。

### Steam 整合點（尚未啟用）

`desktop/steam.cjs` 已寫好，但需要兩個條件才會啟動：
1. 在 `desktop/` 執行 `npm i steamworks.js`；
2. 提供 Steam App ID：環境變數 `STEAM_APP_ID`，或在 exe 旁放 `steam_appid.txt`（上架包由 Steam 自動處理）。

| 功能 | 做法 |
|---|---|
| 成就 | 已存在職涯存檔並顯示在職涯「成就」分頁；遊戲結算後依存檔計算（`shared/achievements.ts`，20 個，ID 例如 `FIRST_SHIFT`、`BOSS`、`LV30`），呼叫 Steam 解鎖。請在 Steamworks 後台建立相同 API 名稱 |
| 好友邀請 | 在多人房間時設定 rich presence `connect = +join 房間碼`；好友在 Steam 按「加入遊戲」→ 遊戲以 `+join 房間碼` 啟動（或已開啟時轉送）→ 自動加入同一房間。手機玩家輸入同一組房間碼即可同房 |
| 雲端存檔 | 尚未做。可用 Steam Auto-Cloud 同步 Electron 的 localStorage 資料夾（後台設定，不需改程式） |

## 商店素材（`store/`）

全部由程式產生，可重跑：

```bash
node store/src/make.mjs        # 圖示、啟動畫面、Steam 橫幅、Google Play 主視覺
npx @capacitor/assets generate --android --ios --iconBackgroundColor '#c2255c' --splashBackgroundColor '#fff4e6' --splashBackgroundColorDark '#141821'
python3 store/src/shrink.py <png...>   # 壓縮成 256 色 PNG
npm run build && npm start &   # 截圖需要遊戲在跑
node store/src/screens.mjs     # 商店截圖 → store/screenshots/
```

| 檔案 | 尺寸 | 用途 |
|---|---|---|
| `store/icon-512.png`、`icon-1024.png` | 512²、1024² | Google Play 圖示、App Store 圖示 |
| `store/google-play-feature-1024x500.png` | 1024×500 | Google Play 主視覺 |
| `store/steam-header-460x215.png` | 460×215 | Steam 頁首（Steam 實際要求尺寸會更新，上傳前對照後台說明） |
| `store/steam-capsule-616x353.png` | 616×353 | Steam 主要宣傳圖 |
| `store/steam-library-hero-3840x1240.png` | 3840×1240 | Steam 收藏庫主圖 |
| `store/screenshots/01–05` | 1920×1080 | 電腦／Steam 截圖：職涯、技能、營業、抓奧客、魔王 |
| `store/screenshots/06-touch.png` | 1920×960 | 手機橫向截圖（觸控按鈕） |
| `assets/` | — | Capacitor 圖示／啟動畫面原始檔 |

商店文字草稿：[STORE-LISTING.md](STORE-LISTING.md)；隱私權政策草稿：[PRIVACY.md](PRIVACY.md)。
