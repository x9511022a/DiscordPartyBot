# Discord 約會與 Party 機器人

繁體中文 Discord Bot，提供 18+ 自我聲明、約會徵求與私人申請、Party 報名／候補、封鎖、檢舉及管理員處置。資料依 Discord 伺服器隔離，公開貼文只顯示區域，詳細地址僅提供給成功媒合或正式參加者。

> 18+ 流程只是自我聲明，不等同身分或年齡驗證。上線前仍應準備清楚的社群規範、危機處理流程與真人管理團隊。

## 快速部署

需求：Docker 與 Docker Compose、Discord Application，以及一個 bot token。

1. 在 Discord Developer Portal 建立 Application 與 Bot。安裝時加入 `bot` 和 `applications.commands` scopes。
2. Bot 建議授予：查看頻道、傳送訊息、嵌入連結、讀取訊息歷史、管理討論串、建立私人討論串、在討論串傳訊及管理頻道權限。
3. 複製 `.env.example` 為 `.env`，填入 `DISCORD_TOKEN`、`DISCORD_CLIENT_ID`，並將資料庫 host 保持為 `db`。
4. 首次開發可填 `DISCORD_GUILD_ID`，讓 slash commands 即時出現；正式全域註冊時留空。
5. 註冊指令並啟動：

```bash
docker compose run --rm bot pnpm run commands:register
docker compose up -d --build
docker compose logs -f bot
```

Bot 容器啟動時會自動執行 `prisma migrate deploy`。

## Discord 初始設定

先建立以下文字頻道：

- 約會貼文頻道：所有合資格成員可查看。
- 公開 Party 頻道：所有合資格成員可查看。
- 私人媒合區：必須禁止 `@everyone` 查看；bot 會在媒合時只為雙方授權並建立私人討論串。
- 管理紀錄頻道：只允許管理團隊與 bot 查看。
- Role 專屬 Party 頻道：禁止 `@everyone` 查看，只允許指定 Role、管理員與 bot 查看。

管理員依序執行：

1. `/setup channels` 設定四個主要頻道。
2. 每個限定 Role 執行一次 `/setup role_channel`。
3. `/setup show` 確認設定。
4. 一般成員執行 `/開始使用 確認:是` 後才可發布和報名。

## 主要流程

- `/date create` 先填時間和公開區域，再由 Modal 填活動、私密地址、費用、希望對象及注意事項。
- 成員按「申請」並填自介；發起者在 bot 私訊按接受或拒絕。接受時若私人討論串建立失敗，資料庫狀態會回滾，不會揭露地址。
- `/party create` 可選 Role；未選即發布至公開 Party 頻道。正式名額滿後自動進候補，正式參加者退出時依序遞補。
- `/date edit`、`/party edit` 可更新進行中的活動；公開貼文會同步更新。貼文按鈕或 `/date cancel`、`/party cancel` 可取消並通知參與者。
- `/我的活動` 顯示最近的發布、申請和報名；`/block`、`/unblock`、`/report` 提供安全工具。
- `/moderate` 支援警告、暫停、封禁、解除與下架內容；可關聯 `report_id` 並結案。
- `/privacy delete` 刪除一般活動與同意資料，未結檢舉及相關管理紀錄保留。

## 本機開發與測試

需要 Node.js 22、pnpm 與 PostgreSQL 16：

```bash
pnpm install
pnpm run db:generate
pnpm run db:dev
pnpm run commands:register
pnpm run dev
```

驗證：

```bash
pnpm run build
pnpm test
```

整合驗收應在測試伺服器以兩個以上帳號執行：同時搶最後名額、互相封鎖後申請、無 Role 成員存取專屬頻道、私訊關閉、bot 缺少討論串權限、取消通知及管理員處置。公開貼文不得出現 `privateLocation`。

## 保留與限制

- 結束／取消活動預設保留 30 天；已結檢舉與管理紀錄預設 180 天，可由 `.env` 調整。
- 速率限制為每伺服器、每使用者計算。預設每日 3 篇約會、5 個 Party、20 次約會申請，每類操作冷卻 10 秒。
- 第一版不提供跨伺服器探索、滑卡、演算法配對、金流、地圖、照片審核或外部後台。
