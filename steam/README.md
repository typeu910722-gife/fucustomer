# SteamPipe 上傳（把遊戲檔案傳到 Steam）

這個資料夾放的是上傳 Windows 版到 Steam 用的設定檔範本。**上傳要在你自己的電腦上做**，用你自己的 Steamworks 帳號登入；帳號密碼只在 steamcmd 視窗裡輸入，**不要寫進任何檔案、不要 commit、不要貼給任何人（包括 AI）**。

| 檔案 | 用途 |
|---|---|
| `app_build_TEMPLATE.vdf` | App 建置腳本範本（`__APPID__`、`__DEPOTID__` 等是佔位符） |
| `depot_build_TEMPLATE.vdf` | Depot 內容範本：把 `release/desktop/win-unpacked/` 整個資料夾上傳 |
| `make-vdf.mjs` | 讀 `desktop/steam.config.json` 的 App ID，產生可用的 `steam/build/*.vdf`（已加入 .gitignore） |
| `achievements.ts` → `achievements.csv` | 成就清單（API 名稱、中文名稱、說明、圖示檔名），照著在後台建立 |
| `rich_presence_tchinese.vdf`、`rich_presence_english.vdf` | 好友列表顯示「正在顧店／多人房間 XXXXX」用的文字，上傳到後台 |

## 一次性準備

1. 在 Steamworks 後台拿到 **App ID**（付完 Steam Direct 費用、建立 App 後就有）。
2. 打開 `desktop/steam.config.json`，把 `"appId": 0` 改成你的 App ID（例如 `"appId": 3456780`）。**全專案只有這一個地方要填。**
   - `depotId` 留 0 就好：Steam 預設的 Windows Depot ID 是 App ID + 1。如果後台顯示的 Depot ID 不一樣，再填進去。
3. 下載 Steamworks SDK（後台 → 「Steamworks SDK」，免費），解壓後裡面的 `tools/ContentBuilder/builder/steamcmd.exe`（Windows）就是上傳工具。也可以用 Valve 單獨提供的 steamcmd。
   - 需要 Node.js 20 以上（跑 `make-vdf.mjs` 和建置用）。

## 每次發版

```bash
# 1. 在專案根目錄建出 Windows 版（會用正式多人伺服器網址重建遊戲畫面）
npm install
npm run desktop:win          # → release/desktop/win-unpacked/FUCustomer.exe 與 zip

# 2. 產生填好 App ID 的上傳腳本
node steam/make-vdf.mjs      # → steam/build/app_build_<AppID>.vdf

# 3. 上傳（第一次會要求 Steam Guard 驗證碼）
steamcmd +login 你的Steam帳號 +run_app_build "完整路徑/steam/build/app_build_<AppID>.vdf" +quit
```

- 密碼：steamcmd 會在終端機裡問你，直接輸入即可。**不要**把密碼放在指令列參數或腳本裡。
- 上傳完到後台「SteamPipe → Builds」，會看到一個新的 Build。把它設到 `default` 分支（第一次會要你確認），再按「Publish」。
  範本裡 `"SetLive"` 是空的，所以上傳**不會**自動上線，要你在後台手動設定，比較安全。
- 想先給朋友測試：後台建一個 `beta` 分支（可設密碼），把 Build 設到那個分支；朋友在 Steam 遊戲內容 → 測試版 輸入密碼即可。

## 啟動設定（後台 → 安裝 → 一般 → 啟動選項）

| 欄位 | 填什麼 |
|---|---|
| 可執行檔 | `FUCustomer.exe` |
| 引數 | （空白）。想預設視窗模式可填 `--windowed` |
| 作業系統 | Windows，64 位元 |

Steam Deck／Linux 玩家會透過 Proton 跑 Windows 版（沒在 Steam Deck 實機測過）。

## 注意

- 建置在哪台電腦做都可以，但 `make-vdf.mjs` 會把**這台電腦上**的 `release/desktop/win-unpacked` 絕對路徑寫進 vdf，所以產生 vdf 和執行 steamcmd 要在同一台電腦。
- `steam_appid.txt` 不需要也不要放進上傳內容（範本已排除）；從 Steam 啟動時 Steam 會自己告訴遊戲 App ID。
