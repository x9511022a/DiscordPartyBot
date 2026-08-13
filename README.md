# DiscordPartyBot

以繁體中文嵌入式面板操作的 Discord 約會與派對機器人。提供 18+ 自我聲明、約會徵求與私人媒合、派對報名／候補、封鎖、檢舉及管理員處置。公開貼文只顯示區域，詳細地址僅提供給成功媒合或正式參加者。

> 18+ 流程只是使用者自我聲明，不等同身分或年齡驗證。正式營運仍應準備社群規範、危機處理流程及真人管理團隊。

## 快速部署

需求：Docker Desktop 或 Docker Engine、Docker Compose、Discord Application 與 Bot token。

1. 在 Discord Developer Portal 建立 Application 與 Bot。
2. 安裝至伺服器時加入 `bot` 與 `applications.commands` scopes。
3. Bot 建議授予：查看頻道、傳送訊息、嵌入連結、讀取訊息歷史、建立私人討論串、在討論串傳送訊息及管理討論串。新版不再需要「管理頻道」或「管理身分組」。
4. 複製 `.env.example` 為 `.env`，填入 `DISCORD_TOKEN`、`DISCORD_CLIENT_ID`；開發伺服器可另填 `DISCORD_GUILD_ID`。
5. 註冊繁體中文指令並啟動：

```bash
docker compose run --rm --build bot pnpm run commands:register
docker compose up -d --build
docker compose logs -f bot
```

重新註冊會以 `/設定`、`/選單` 取代舊版指令。Bot 啟動時會自動執行資料庫 migration。

## Discord 初始設定

先建立下列文字頻道：

- 操作面板頻道：放置常駐功能入口。
- 約會貼文頻道：顯示公開約會徵求。
- 公開派對頻道：顯示公開派對。
- 管理紀錄頻道：只允許管理團隊與 Bot 查看。
- 身分組專屬派對頻道：禁止 `@everyone` 查看，只允許指定身分組、管理員與 Bot 查看。

管理員依序執行：

1. `/設定 頻道` 選擇操作面板、約會貼文、公開派對及管理紀錄四個主要頻道，Bot 會自動發布或更新常駐面板。
2. 如需限定派對，使用 `/設定 身分組頻道` 建立身分組與頻道的對應。
3. 使用 `/設定 查看` 確認設定。

## 使用方式

- 成員可點擊常駐面板，或執行 `/選單` 開啟只有自己看得到的操作面板。
- 首次使用需在面板確認年滿 18 歲並同意規範。
- 建立約會或派對時，文字資料使用 Discord 彈出表單，日期與時間使用下拉選單選取。
- 約會媒合成功後，Bot 會在該約會貼文所在頻道建立私人討論串，只加入雙方。
- 派對發布後，Bot 會在該派對貼文所在頻道建立私人討論串，只加入發起者及正式參加者；候補遞補與退出會同步更新成員。
- 私人討論串於 24 小時無活動後自動封存；活動取消或到達排定時間時會立即鎖定並封存。
- 日期可選未來 90 天；時間以台北時間解讀，分鐘為 `00／15／30／45`。
- 「我的活動」可直接從清單選擇、編輯或取消，不需複製活動編號。
- 「安全與隱私」提供封鎖、解除封鎖、檢舉及刪除一般資料。
- 具管理成員權限者會看到「管理員中心」，可處理檢舉與執行警告、暫停、封禁、解除或下架內容。

## 更新既有部署

```bash
git pull
docker compose run --rm --build bot pnpm run commands:register
docker compose up -d --build
docker compose logs -f bot
```

改版後請重新執行一次 `/設定 頻道`，指定新增的操作面板頻道。既有活動、申請、報名、封鎖及檢舉資料會保留。

## 本機開發與測試

需要 Node.js 22、pnpm 與 PostgreSQL 16：

```bash
pnpm install
pnpm run db:generate
pnpm run db:dev
pnpm run commands:register:dev
pnpm run dev
```

```bash
pnpm run build
pnpm test
```

## 保留與限制

- 結束或取消的活動預設保留 30 天；已結檢舉與管理紀錄預設保留 180 天。
- 預設每日可建立 3 篇約會、5 個派對及送出 20 次約會申請，每類操作冷卻 10 秒。
- 第一版不提供跨伺服器探索、演算法配對、金流、地圖、照片審核或外部管理後台。
