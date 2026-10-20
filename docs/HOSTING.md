# 公開伺服器規劃（使用者選 A：Cloudflare）

狀態：**已選定方向，尚未建置、尚未註冊或付費任何服務。** 上線前需要使用者自己用 Cloudflare 帳號部署（金鑰只放在 Cloudflare 後台，不放進遊戲或交付包）。

## 為什麼是 Cloudflare Workers + Durable Objects

- 網站已經在 Cloudflare Pages，同一個帳號就能管理。
- 每個多人房間、每家好友的店都可以是一個 Durable Object（自帶 SQLite 資料庫、能收 WebSocket），剛好對應現在伺服器的「房間」和「店碼」。
- 查官方文件（2026-10-20）：**Durable Objects 在免費的 Workers Free 方案也能用**（限 SQLite 儲存），免費額度：每天 500 萬列讀取、10 萬列寫入、總共 5 GB 資料；超過免費額度時該類操作會失敗（不會自動扣款）。付費方案（Workers Paid）另計，費用以官方頁面為準：https://developers.cloudflare.com/durable-objects/platform/pricing/
- 注意：遊戲房間每秒更新 20 次是「運算時間」，免費方案的每日請求／運算額度要實測後才知道能撐多少人同時玩。上線前會先做壓力測試，再請你決定是否升級付費方案。

## Supabase 要不要用？

- Supabase 是「資料庫＋登入＋即時廣播」服務。它的即時功能是轉發訊息，**不會幫我們跑遊戲邏輯**，多人房間還是需要一個一直在算的伺服器（Durable Objects 正好做這件事）。
- 好友的店（存店碼、鎖門、報告）Durable Objects 的 SQLite 就夠用，不需要再加一個服務。
- Supabase 適合之後要做**帳號登入、排行榜、跨裝置存檔**時再考慮。免費方案的專案約一週沒有活動會暫停（可手動恢復），付費方案每月約 US$25 起（第三方整理，以官方為準）。
- 結論：**目前不用**；等要做帳號系統時再評估（也可以用 Steam／Apple／Google 登入，不一定需要 Supabase）。

## 改寫工作（之後的回合）

1. `server/` 的房間迴圈搬進 Durable Object（`shared/` 的模擬程式碼可以直接共用）。
2. 店碼 API（`server/stores.ts`）改存 Durable Object SQLite。
3. 本機伺服器保留，用來開發與測試。
4. 防作弊：搗亂回合改由伺服器跑（使用者說「之後再說」）。
