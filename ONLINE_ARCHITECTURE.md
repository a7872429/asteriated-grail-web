# 線上版架構（部署前必讀）

## 為什麼不能用前端加密保護評分

GitHub Pages 只會把 HTML、CSS、JavaScript 靜態檔案送到玩家瀏覽器。任何送到瀏覽器的評分公式、權重、解密金鑰、WebAssembly 或混淆程式，都能被下載、攔截或分析。正式線上版必須把評分、學習推薦與電腦決策移到不公開的後端。

## 建議部署

- 公開 GitHub 儲存庫：只放前端與角色圖片，使用 GitHub Pages。
- 私人 GitHub 儲存庫：放 Cloudflare Worker、Durable Objects、D1 schema 與評分引擎。
- Cloudflare Worker：驗證所有移除、禁角、Insert Ban、選角、座位與回合操作。
- Durable Objects：一個對戰房間一個狀態物件，處理配對、隨機紅藍方、斷線重連及即時同步。
- D1：儲存角色池、逐步選禁事件、座位、分數、勝負與匿名玩家識別碼。

## 建議資料表

- `matches`：房間、模式、連戰局數、紅藍玩家、開始／結束時間、勝負及版本。
- `match_pools`：每場開出的全部可選角色與 RD+BP 分隊結果。
- `draft_events`：事件序號、操作者、陣營、動作、角色、座位、伺服器時間及是否超時。
- `lineups`：最終紅藍陣容、座位與伺服器評分。
- `sessions`：匿名玩家、重連權杖與到期時間；不要蒐集不必要的個資。

## 防止竄改

瀏覽器只能提出操作意圖，不能自行決定角色池、紅藍方、輪次或結果。伺服器每次都要驗證房間版本與合法步驟，成功後才寫入 D1 並廣播新狀態。評分 API 只回傳顯示分數；學習 API 只回傳推薦角色 ID，不回傳權重或計算明細。

## 尚需外部設定

1. GitHub 公開前端儲存庫名稱與 Pages 發布分支。
2. Cloudflare 帳號、Worker 專案名稱與允許的 GitHub Pages 網域。
3. D1 資料庫及 Durable Objects binding。
4. 將目前前端評分核心搬入私人 Worker，移除公開檔案中的原始評分資料。
