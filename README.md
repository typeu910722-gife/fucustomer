# 奧客退散 FUCustomer

第一人稱便利商店經營＋奧客事件處理。單人職涯模式：從試用期工讀生升到「終極打工人」（30 級、6 章主線）；另有自由營業與最多 5 人合作（測試中）。

> **目前狀態（誠實標示）**：可在瀏覽器（電腦／手機）遊玩的單人與多人連線版本已完成並通過自動化測試。
> **iOS／Android／Steam(Windows) 原生建置尚未產出**，見 [docs/ISSUES.md](docs/ISSUES.md)。

## 快速開始

```bash
npm install
npm run build          # 打包用戶端(dist/) 與伺服器(dist-server/)
npm start              # http://localhost:8787 （同時提供網頁與 WebSocket /ws）
```

開發模式：`npm run dev:server`（:8787）＋ `npm run dev:client`（Vite :5173，會自動連 :8787）。

## 技術決定

| 項目 | 選擇 | 理由 |
|---|---|---|
| 用戶端 | TypeScript + Three.js | 同一份程式跑在電腦、手機與桌面殼；此開發環境可直接以瀏覽器自動化實測 |
| 連線 | 專用權威伺服器（Node + WebSocket） | 玩家不需設定路由器、跨網路與跨平台同房；交易在伺服器驗證 |
| 單人 | 同一份 `Room`/模擬在瀏覽器內執行 | 單人與多人共用規則，單人可暫停 |
| iOS / Android | Capacitor 原生殼（規劃中） | 直接包裝現有用戶端，連同一台伺服器 |
| Steam (Windows) | Electron（規劃中）＋ steamworks.js | Steam 邀請轉成房間碼加入，手機用同一組碼 |

## 專案結構

```
shared/     遊戲規則（純邏輯，伺服器與用戶端共用）
  sim.ts      權威模擬：顧客、奧客、金錢、庫存、升級、日結
  room.ts     房間：等候室、5 人上限、準備/開始、重連、房主轉移、檢查點
  map.ts      店面配置、碰撞、NPC 尋路
  bot.ts      模擬玩家（測試用，只看封包、只送封包）
  career.ts   職涯：職級、經驗、技能樹、裝備、6 章班次、星級與獎勵
server/     專用伺服器（房間碼、心跳、限流、檢查點寫檔、SIGTERM 安全關閉）
client/     Three.js 第一人稱用戶端（鍵鼠、手把、多點觸控、小地圖、HUD、選單、音效）
tests/      sim.test.ts（規則）、net.test.ts（真實伺服器＋多個 WebSocket 客戶端）、e2e/（瀏覽器）
docs/       伺服器設定、實測紀錄、剩餘問題
```

## 測試

```bash
npm run typecheck
npm test            # 規則/房間測試（模擬玩家，不經網路）
npm run test:net    # 啟動真實伺服器，多個 WebSocket 客戶端（同一台機器）
npm run test:e2e    # 需先 npm run build && npm start：瀏覽器單人＋雙瀏覽器多人＋職涯＋教學／魔王／無限夜班
npm run balance     # 模擬玩家跑完每個班次，輸出難度平衡表
```

測試分類與結果見 [docs/TEST-LOG.md](docs/TEST-LOG.md)。

## 操作

- 電腦：WASD 移動、Shift 跑、滑鼠視角、左鍵/E 互動、右鍵/F 次要、G 放下、空白 抓起/丟出、Q 拖把旋風、R 全店退散、V 標記、T 快捷訊息、B 採購、Enter 準備、Esc/P 選單
- 手把（標準配置）：左搖桿移動、右搖桿視角、A 互動、X 次要、B 放下、Y 抓/丟、RB 旋風、LB 全店退散、L3/LT 跑、十字鍵 上標記/下採購/右準備、Start 選單
- 手機（橫向）：左半邊拖曳搖桿、右半邊拖曳視角、互動／放下／抓丟／旋風／退散／跑步按鈕，多點觸控
