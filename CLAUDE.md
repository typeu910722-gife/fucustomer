# 給 Claude 的專案規則

## 溝通（最重要）
- **跟使用者講話一律用繁體中文。** 回報、提問、說明、結尾摘要全部用中文，不要用英文。程式碼註解和 commit 訊息可以維持英文。

## 分支與部署
- 只推到 `claude/trusting-planck-eb99wg`。**不要推或合併到 `main`**（main 會自動部署到 fucustomer.yzprojecttw.com，要維持最初的簡單版本），除非使用者明確要求。
- 不註冊、不使用任何付費服務；需要付費的主機要先問使用者。金鑰不得放進客戶端或交付包。
- 測試要誠實標示：模擬玩家／同一台電腦多開／跨平台實機是不同的東西。不可把「網站完成」說成三平台已建置或已上架。

## 升級循環
- 每一輪做完：跑測試（typecheck、npm test、test:net、build、test:e2e、electron）→ 更新 docs/TEST-LOG.md → commit + push → 更新試玩頁 → 用中文簡短回報 → 20 分鐘後開始下一輪，直到使用者說「暫停」。使用者的新回饋優先。

## 其他
- 新增遊戲文字後要跑 `python3 scripts/font-subset.py`（字型只保留用到的字）。
