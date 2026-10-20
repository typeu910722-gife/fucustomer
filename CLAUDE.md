# 給 Claude 的專案規則

## 溝通（最重要）
- **跟使用者講話一律用繁體中文。** 回報、提問、說明、結尾摘要全部用中文，不要用英文。程式碼註解和 commit 訊息可以維持英文。

## 分支與部署
- 開發只推到 `claude/trusting-planck-eb99wg`。**不要把開發分支合併進 `main`**（main 會自動部署到 fucustomer.yzprojecttw.com）。
- 使用者 2026-10-20 要求：**正式網址 fucustomer.yzprojecttw.com 要一直是最新、完整測試通過的版本。** 每輪完整測試通過後，把同一份建置（`VITE_SERVER_URL=wss://fucustomer-game.typeu910722.workers.dev/ws`）同時放到 main 根目錄和 `beta/`（beta 另外放 beta-pages/ 的安裝頁、iOS 描述檔、APK）。舊的 v0.4 保留在 main 的 `v04/`，不要刪。沒有完整測試通過的版本不能放上去。
- 不註冊、不使用任何付費服務；需要付費的主機要先問使用者。金鑰不得放進客戶端或交付包。
- 測試要誠實標示：模擬玩家／同一台電腦多開／跨平台實機是不同的東西。不可把「網站完成」說成三平台已建置或已上架。

## 升級循環
- 每一輪做完：跑測試（typecheck、npm test、test:net、build、test:e2e、electron）→ 更新 docs/TEST-LOG.md → commit + push → 更新試玩頁 → 用中文簡短回報 → 20 分鐘後開始下一輪，直到使用者說「暫停」。使用者的新回饋優先。

## 其他
- 新增遊戲文字後要跑 `python3 scripts/font-subset.py`（字型只保留用到的字）。
