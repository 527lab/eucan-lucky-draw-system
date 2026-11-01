# 功能規格（spec.md）

> 版本：S0c（2026-11-01；員工身分改為「僅員工編號」查證、/admin 加 Cloudflare Access）
> 活動：2027 年 1 月初公司員工旅遊，參與人數約 30–40 人
> 相關文件：[architecture.md](./architecture.md)、[open-questions.md](./open-questions.md)、[tasks.md](./tasks.md)

## 1. 目標與範圍

### 1.1 目標
1. 員工加 LINE 官方帳號（以下稱 OA）好友，在指定景點拍合照並傳給 OA。
2. 系統依「設定值」決定每張照片能不能換到抽獎券、要不要人工審核。
3. 管理員在後台管理景點、獎品、審核照片，並觸發抽獎（可投影到大螢幕）。
4. 抽獎結果自動用 LINE 通知得獎者。

### 1.2 不在範圍內（S0 決定）
- 不做 LIFF 或網頁版上傳介面，全部流程在 LINE 聊天室裡完成（減少開發量，員工也不用學新東西）。
- 不做照片 AI 辨識（判斷照片是不是在景點拍的）。要把關就開人工審核。
- 不做多活動或多租戶，系統只服務這一場活動；但規則全部做成設定值，之後可以重複用。
- 不處理獎品寄送或物流。

### 1.3 「做成設定值、不寫死」的項目
以下三件事目前還沒定案，**一律做成後台可改的設定**（詳見第 7 節）：
| 待定事項 | 設定鍵 | 預設值 |
|---|---|---|
| 抽獎券規則 | `ticket.mode` | `per_spot`（每個景點一張） |
| 照片是否人工審核 | `review.mode` | `auto`（自動通過，管理員事後可以退件） |
| 景點數量與位置 | `spots` 資料表（後台 CRUD） | 無，由管理員建立 |

## 2. 角色

| 角色 | 說明 | 介面 |
|---|---|---|
| 參加者 | **僅公司員工**（無眷屬）；在 LINE 輸入員工編號，由請假系統查證是否有效（見 architecture.md §7） | LINE 聊天室 |
| 管理員 | David 和指定的福委或 HR | 網頁後台 `/admin`（Cloudflare Access + 管理密碼，兩道門） |
| 大螢幕 | 抽獎現場投影 | 網頁 `/admin/draw/live`（需要管理員登入） |

## 3. 參加者流程（LINE 端）

### 3.1 加入與報名
1. 員工掃 QR code 加 OA 好友，觸發 `follow` 事件。
2. 系統建立或恢復 `participants` 紀錄，並取得 LINE 顯示名稱和大頭貼（Get profile API）。
3. 依 `registration.mode` 處理：
   - `employee`（**預設**）：Bot 請使用者輸入「員工編號」，系統向請假系統查證該編號存在且在職（只回 是/否，不取其他資料），通過就把這個 LINE 帳號與該編號綁定。**同一編號只能對應一個 LINE 帳號**（先到先綁）、連續輸入錯誤會暫時鎖定，管理員可在後台解除綁定（細節見 architecture.md §7.3）。未通過者不能上傳照片、不進獎池。
   - `none`：直接可以參加，以 LINE 顯示名稱識別。
   - `name`（備援，名單不可用時）：Bot 請使用者回覆「真實姓名」，收到後完成報名。
   - `code`：Bot 請使用者輸入活動通關碼（`registration.joinCode`），通過後再輸入姓名。這可以防止外部人士加好友來參加。
4. 用 **reply message** 回覆歡迎訊息和使用說明（reply 不算進訊息額度）。

> 管理員在後台可以修改姓名、停權或合併參加者。

### 3.2 上傳景點合照（核心流程）
支援兩種順序，兩種都要做：

**A. 先選景點、再傳照片（主要引導路徑）**
1. 使用者點圖文選單（Rich menu）的「📸 上傳打卡照」，或輸入關鍵字「打卡」。
2. Bot 用 Quick Reply 列出「目前開放」的景點（postback action，`data=spot:<spotId>`）。
   - 景點多於 13 個（Quick Reply 的上限）時，改用 Flex carousel。
3. 使用者選擇景點後，系統寫入對話狀態 `awaiting_photo(spotId)`，有效時間為 `upload.pendingSpotTtlMinutes`（預設 10 分鐘）。Bot 回覆 Quick Reply 的「相機」和「相簿」按鈕。
4. 使用者傳照片，觸發 `message.image` 事件，照片就綁定到該景點。

**B. 先傳照片、再選景點（容錯路徑）**
1. 使用者直接傳照片，而且沒有有效的對話狀態。
2. 系統建立 `submission`（`spot_id = null`，狀態為 `pending_spot`），然後用 Quick Reply 問「這張是哪個景點？」（`data=assign:<submissionId>:<spotId>`）。
3. 使用者選擇後，系統補上 `spot_id`，並依審核模式繼續處理。
4. 一次傳多張照片時（webhook 會帶相同的 `imageSet.id`），選一次景點就套用到同一組的全部照片。

**照片處理（兩條路徑共用）**
1. 收到 `message.image` 後，**立刻**用 `GET https://api-data.line.me/v2/bot/message/{messageId}/content` 下載原圖，存進物件儲存。官方文件說使用者傳的內容「會在一段時間後自動刪除」，而且沒有保證保留多久，所以不能延後下載。
2. `contentProvider.type` 不是 `line` 的情況（理論上使用者傳圖不會發生），一律記錄下來然後略過。
3. 依 `review.mode` 處理：
   - `auto`：直接改為 `approved`，回覆「✅ 已收到〇〇景點照片，目前 N 張抽獎券」。
   - `manual`：改為 `pending_review`，回覆「已收到，審核通過後計入」。
4. 以下情況回覆說明文字，不建立 submission，或建立後直接標成 `rejected`：
   - 景點不在開放時間（`spot.available_from/until`）。
   - 超過上傳截止時間（`upload.deadlineAt`）。
   - 抽獎已經開始或結束（`draw.status` 不是 `not_started`）。
5. 同一位參加者同一景點可以傳多張照片，但**抽獎券只算一次**，取最早通過的那一張（見第 5 節）。

### 3.3 查詢進度
- 圖文選單的「📊 我的進度」或關鍵字「進度」→ Bot 用 reply 回覆：
  - 已完成景點、未完成景點、審核中的照片數
  - 目前抽獎券數 / 是否已有資格（依 `ticket.mode`）
  - 上傳截止時間
- 用 Flex Message 呈現（每個景點一列，打勾或空格）。

### 3.4 活動說明
- 圖文選單的「ℹ️ 活動說明」→ 回覆後台設定的說明文字（`messages.rules`）。

### 3.5 中獎通知
- 抽獎完成後，系統對每位得獎者發 **push message**（會用到訊息額度），內容是獎品名稱和領獎方式（`messages.winnerTemplate`）。
- 每則 push 都帶 `X-Line-Retry-Key`（UUID），失敗重試時才不會重複發送。
- 設定 `notify.announceToAll = true` 時，用 multicast 通知全部參加者得獎名單。這會用掉約 30–40 則額度，預設關閉（理由見 architecture.md 的訊息額度預算）。

### 3.6 其他事件
| 事件 | 處理 |
|---|---|
| `unfollow` | `participants.status = unfollowed`；他的抽獎資格是否保留由 `ticket.keepOnUnfollow` 決定（預設 `true`） |
| 文字訊息（無法辨識） | 回覆簡短說明加上 Quick Reply 主選單 |
| 貼圖、影片、位置等 | 回覆「請傳照片喔」 |
| 群組或多人聊天室 | 不處理（只回 200），如果 Bot 被邀進群組就自動退出 |

## 4. 管理後台（`/admin`）

### 4.1 登入
- 採用單一共用管理密碼（環境變數 `ADMIN_PASSWORD_HASH`，存 bcrypt 或 argon2 雜湊）加上 httpOnly 簽章 cookie（`SESSION_SECRET`）。
- 登入失敗做速率限制（同 IP 每分鐘 5 次）。
- **第一道門：Cloudflare Access**。`/admin*` 與 `/api/admin*` 由 Cloudflare Access 保護（只允許管理員 email，一次性 PIN 或 Google 登入），通過後才碰得到登入頁；`/api/line/webhook` 與 `/api/health` 不套用。應用層另外驗證 Access 簽發的 `Cf-Access-Jwt-Assertion`（`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`），production 缺少或無效就回 403；Access 提供的 email 同時作為稽核紀錄的操作者名稱（取代自填名字）。細節見 architecture.md §4.4。
- 大螢幕裝置第一次開 `/admin/draw/live` 時需先通過 Access 登入（session 時間設為 24 小時，避免抽獎當下過期）。
- 理由：管理員只有 2–3 人，活動只用一次，不值得接 OAuth。之後如果要分帳號，再換成 LINE Login。

### 4.2 頁面
| 頁面 | 功能 |
|---|---|
| 儀表板 `/admin` | 報名人數、各景點完成人數、待審照片數、本月 push 額度用量（呼叫 `GET /v2/bot/message/quota` 和 `/quota/consumption`）、抽獎狀態 |
| 景點 `/admin/spots` | 新增、編輯、刪除、排序；欄位見資料模型；可以停用 |
| 參加者 `/admin/participants` | 列表（LINE 暱稱 + 員工編號）、搜尋、停權、**解除員工編號綁定**（換手機或被冒用時）、查看個人照片和抽獎券；手動加減券（需填寫原因）；可看「重複綁定嘗試」紀錄 |
| 員工名單 `/admin/employees` | 僅在 `employees.source = csv` 時使用：上傳／覆蓋員工編號清單（只有編號一欄，作為請假系統 API 不可用時的備援）；`leave-api` 模式下顯示最近一次查證連線狀態 |
| 照片審核 `/admin/submissions` | 縮圖格狀檢視，可依景點或狀態篩選；可單張或批次通過、退件（需填寫退件原因）；退件時是否 push 通知由 `notify.onReject` 決定（預設 `false`，節省額度） |
| 獎品 `/admin/prizes` | 新增、編輯、刪除；欄位包括名稱、數量、圖片、抽出順序 |
| 抽獎 `/admin/draw` | 預覽獎池（每人券數、中獎機率）→ 鎖定 → 開抽 → 結果 → 重抽單一名額 → 發送通知 → 匯出 CSV |
| 大螢幕 `/admin/draw/live` | 全螢幕動畫，一個獎項一個獎項揭曉（由管理員按「下一個」推進） |
| 設定 `/admin/settings` | 第 7 節全部設定項，用 zod 驗證；抽獎鎖定後，影響資格的設定改為唯讀 |
| 訊息範本 `/admin/messages` | 編輯歡迎、說明、得獎等文字（支援 `{name}`、`{prize}` 等變數） |
| 稽核紀錄 `/admin/audit` | 所有管理動作的紀錄 |

## 5. 抽獎券與資格規則

### 5.1 計算原則
- 抽獎券**不是**累加寫入的計數器，而是由「已通過的 submissions + 手動調整」經過**純函式** `computeEntitlements(settings, approvedSubmissions, adjustments)` 推算出來。這樣改設定或退件時結果會自動一致，也容易寫單元測試。
- 每位參加者每個景點最多算 1 次（不論他傳了幾張）。
- 只計入 `spot.counts_for_ticket = true` 的景點（可以設定「暖身景點」不計券）。

### 5.2 模式（`ticket.mode`）
| 模式 | 規則 | 範例（5 個景點，完成 3 個） |
|---|---|---|
| `per_spot` | 每完成 1 個景點得 1 張券，上限為 `ticket.maxPerUser`（null 表示不設上限） | 3 張 |
| `complete_all` | 完成**所有** `required = true` 的景點才有資格，固定 `ticket.ticketsWhenComplete` 張（預設 1） | 0 張（沒資格） |
| `threshold` | 完成至少 `ticket.minSpots` 個景點才有資格，固定 `ticket.ticketsWhenComplete` 張 | `minSpots=3` 時為 1 張 |

最後再加上手動調整（`ticket_adjustments`，可正可負，結果最小為 0）。

### 5.3 抽獎演算法
1. **鎖定獎池**：建立 `draw_runs`，把每人券數和當下設定存成快照（`pool_snapshot`、`settings_snapshot`），狀態改為 `locked`。鎖定後新上傳的照片不再計入。
2. **依照 `prize.draw_order` 由小到大**逐項抽出，每個獎項抽 `quantity` 名。
3. 每抽一名：
   - 用 `crypto.randomInt` 依券數加權隨機選人（券數愈多，機率愈高）。
   - `draw.allowMultipleWins = false`（預設）時，得獎者從獎池移除。
   - 每次抽籤的隨機值寫進 `draw_results.random_value`，方便稽核。
4. 獎池人數不足時，剩下的名額標記為 `unfilled`，不會報錯。
5. **重抽**：管理員可以把某筆結果標成 `void`（例如得獎人不在現場），再從目前剩下的獎池抽出替補。替補紀錄的 `replaces_result_id` 指向原結果。
6. 抽獎是**伺服器端一次算完**全部結果並存入資料庫，大螢幕只負責依序「揭曉」。這樣斷線或重新整理都不會改變結果。
7. 觸發方式：由管理員在後台手動按下（主要方式）。另外可以選擇設定 `draw.scheduledAt` 自動執行（由容器內排程執行，見 architecture.md §4.7）。

### 5.4 通知
- 管理員確認結果後按「發送中獎通知」→ 逐筆 push → 寫入 `outbound_messages`（retry key、狀態、`x-line-request-id`）。
- 失敗的可以單筆重送（沿用同一把 retry key，LINE 回 409 時視為已送達）。

## 6. 資料模型

資料庫為 PostgreSQL，使用 Drizzle ORM。時間一律存 `timestamptz`，顯示時用 `Asia/Taipei`。主鍵用 `uuid`（`gen_random_uuid()`）。

```text
participants
  id                uuid PK
  line_user_id      text UNIQUE NOT NULL     -- 依 provider 而不同的 LINE userId
  employee_no       text UNIQUE NULL         -- 通過查證的員工編號（registration.mode=employee）；一個編號只能綁一個 LINE 帳號
  employee_verified_at timestamptz NULL
  display_name      text                     -- LINE 顯示名稱
  picture_url       text
  real_name         text                     -- 僅 name/code 備援模式報名時輸入；employee 模式不取得姓名，後台以 LINE 暱稱 + 員工編號辨識
  status            enum(pending_registration, active, blocked, unfollowed)
  registered_at     timestamptz
  followed_at       timestamptz
  created_at / updated_at

spots
  id                uuid PK
  name              text NOT NULL
  description       text
  hint_image_url    text                     -- 景點示意圖（選用）
  latitude/longitude numeric NULL            -- 僅供顯示或未來的定位驗證
  sort_order        int
  required          boolean DEFAULT true     -- complete_all 模式是否必須完成
  counts_for_ticket boolean DEFAULT true
  available_from    timestamptz NULL
  available_until   timestamptz NULL
  active            boolean DEFAULT true
  created_at / updated_at

submissions
  id                uuid PK
  participant_id    uuid FK → participants
  spot_id           uuid FK → spots NULL     -- null 表示 pending_spot
  line_message_id   text UNIQUE NOT NULL     -- 冪等鍵
  image_set_id      text NULL
  storage_key       text NOT NULL            -- 物件儲存路徑（隨機、不可猜）
  content_type      text
  size_bytes        int
  status            enum(pending_spot, pending_review, approved, rejected)
  reject_reason     text
  reviewed_by       text
  reviewed_at       timestamptz
  created_at        timestamptz             -- 以 LINE webhook 的 timestamp 為準
  INDEX (participant_id, spot_id, status)

employee_allowlist                         -- 僅 employees.source=csv 時使用（備援）；只存編號
  employee_no       text PK
  imported_at       timestamptz

employee_bind_attempts                     -- 失敗鎖定與冒用稽核
  id                uuid PK
  line_user_id      text
  employee_no_hash  text                     -- 嘗試的編號（雜湊，避免留存大量輸入）
  result            enum(ok, invalid, already_bound, locked)
  created_at        timestamptz

conversation_states
  participant_id    uuid PK FK
  state             enum(awaiting_photo, awaiting_employee_no, awaiting_name, awaiting_join_code)
  spot_id           uuid NULL
  image_set_id      text NULL
  expires_at        timestamptz

ticket_adjustments
  id                uuid PK
  participant_id    uuid FK
  delta             int NOT NULL
  reason            text NOT NULL
  created_by        text
  created_at

prizes
  id                uuid PK
  name              text NOT NULL
  description       text
  image_url         text
  quantity          int NOT NULL CHECK (quantity > 0)
  draw_order        int NOT NULL             -- 小的先抽
  created_at / updated_at

draw_runs
  id                uuid PK
  status            enum(locked, drawn, announced, cancelled)
  settings_snapshot jsonb
  pool_snapshot     jsonb                    -- [{participantId, tickets}]
  triggered_by      text
  locked_at / drawn_at / announced_at
  -- 同時間只能有一筆非 cancelled 的 run（partial unique index）

draw_results
  id                uuid PK
  draw_run_id       uuid FK
  prize_id          uuid FK
  slot              int                      -- 該獎項的第幾名
  participant_id    uuid FK NULL             -- unfilled 時為 null
  status            enum(won, void, unfilled)
  random_value      bigint
  replaces_result_id uuid NULL FK → draw_results
  revealed_at       timestamptz NULL         -- 大螢幕揭曉時間
  created_at

outbound_messages
  id                uuid PK
  participant_id    uuid FK NULL
  kind              enum(winner, reject_notice, announce, other)
  method            enum(push, multicast)
  retry_key         uuid UNIQUE
  status            enum(pending, sent, failed)
  line_request_id   text
  error             text
  related_id        uuid NULL                -- 例如 draw_result_id
  created_at / sent_at

webhook_events
  webhook_event_id  text PK                  -- LINE 提供，用於去重
  type              text
  line_user_id      text
  is_redelivery     boolean
  status            enum(received, processed, failed)
  error             text
  payload           jsonb
  received_at / processed_at

settings
  key               text PK
  value             jsonb
  updated_by        text
  updated_at

admin_audit_logs
  id                uuid PK
  actor             text
  action            text                     -- e.g. submission.approve, draw.lock
  target_type/target_id text
  payload           jsonb
  created_at
```

## 7. 設定項

設定分成兩層：
1. **環境變數**：機密和部署相關，絕對不寫進 repo，只提供 `.env.example`（只有鍵名、沒有值）。
2. **業務設定**：存在 `settings` 表，由程式內 zod schema 定義預設值，後台可以修改。

### 7.1 環境變數（只列名稱）
| 名稱 | 用途 |
|---|---|
| `LINE_CHANNEL_SECRET` | 驗證 webhook 簽章 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 呼叫 Messaging API（長期 token 或 v2.1 token，見 architecture.md） |
| `DATABASE_URL` | Postgres 連線字串（compose 內部網路） |
| `PHOTO_STORAGE_DIR` | 照片 volume 掛載路徑（例如 `/data/photos`） |
| `TUNNEL_TOKEN` | Cloudflare Tunnel token（給 `cloudflared` 容器，不進 app） |
| `LEAVE_API_BASE_URL` / `LEAVE_API_TOKEN` | 請假系統「員工編號查證」API（`employees.source=leave-api` 時需要） |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | 驗證 Cloudflare Access JWT（production、staging 必填；本機開發可留空並關閉檢查） |
| `ADMIN_PASSWORD_HASH` | 管理密碼雜湊 |
| `SESSION_SECRET` | cookie 簽章 |
| `CRON_SECRET` | 保護排程端點 |
| `APP_BASE_URL` | 產生連結用 |
| `APP_ENV` | `development` / `test` / `production` |

### 7.2 業務設定（`settings` 表）
| 鍵 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `event.name` | string | `"EUCAN 2027 員工旅遊"` | 顯示用 |
| `event.timezone` | string | `"Asia/Taipei"` | |
| `registration.mode` | `employee`\|`name`\|`code`\|`none` | `employee` | 3.1；`employee` 需有員工名單 |
| `employees.source` | `csv`\|`leave-api` | `csv` | 員工編號查證來源；請假系統 API 就緒後改 `leave-api`（architecture.md §7） |
| `registration.maxFailures` / `registration.lockMinutes` | int | 5 / 15 | 編號輸入錯誤鎖定 |
| `registration.joinCode` | string\|null | null | `code` 模式使用 |
| `upload.startAt` | datetime\|null | null | 早於這個時間的照片不收 |
| `upload.deadlineAt` | datetime\|null | null | 截止時間 |
| `upload.pendingSpotTtlMinutes` | int | 10 | 選景點後的等待時間 |
| `upload.maxPerSpotPerUser` | int | 5 | 防止洗版，超過後回覆提示 |
| `review.mode` | `auto`\|`manual` | `auto` | 照片是否人工審核 |
| `ticket.mode` | `per_spot`\|`complete_all`\|`threshold` | `per_spot` | 5.2 |
| `ticket.maxPerUser` | int\|null | null | `per_spot` 上限 |
| `ticket.minSpots` | int | 1 | `threshold` 使用 |
| `ticket.ticketsWhenComplete` | int | 1 | `complete_all`、`threshold` 使用 |
| `ticket.keepOnUnfollow` | boolean | true | 封鎖 OA 後是否保留資格 |
| `draw.allowMultipleWins` | boolean | false | 一人是否可以中多個獎 |
| `draw.scheduledAt` | datetime\|null | null | 自動開抽（選用） |
| `draw.autoNotify` | boolean | false | 抽完自動發通知，或等管理員確認後再發 |
| `notify.onApprove` | boolean | false | 人工審核通過時是否 push（會用掉額度） |
| `notify.onReject` | boolean | false | 退件時是否 push |
| `notify.announceToAll` | boolean | false | 是否 multicast 得獎名單 |
| `messages.welcome` / `messages.rules` / `messages.winnerTemplate` / … | string | 內建範本 | 訊息範本 |

### 7.3 設定鎖定
- `draw_runs` 進入 `locked` 之後，`ticket.*`、`review.mode` 改為唯讀。必須先「取消本次抽獎」才能修改。

## 8. 非功能需求
| 項目 | 要求 |
|---|---|
| 負載 | 40 人 × 每人約 10 張照片；尖峰估計每秒 < 10 個 webhook。系統要承受 10 倍餘裕 |
| Webhook 回應 | 驗簽、寫入事件、回 200 要在 1 秒內完成。下載照片和回覆訊息在回應後背景執行（`after()`） |
| 冪等 | `webhookEventId` 和 `line_message_id` 唯一鍵；重送的事件（`deliveryContext.isRedelivery`）不重複處理 |
| 安全 | 一律驗證 `x-line-signature`（HMAC-SHA256、channel secret、原始 body）；後台全部需要 Cloudflare Access + 登入；照片不公開，透過後台受保護的路由讀取 |
| 隱私 | 照片和姓名只在活動期間使用。活動結束 30 天後，由管理員按鈕或排程刪除照片（`privacy.purgeAfterDays`，預設 30） |
| 可觀測性 | 結構化 log（含 `webhookEventId`）；後台可以查失敗的 webhook 和 push |
| 可用性 | 活動當天如果系統掛掉，照片仍然留在 LINE 聊天室，可以人工補登。後台提供「手動新增 submission」 |
| 語系 | 繁體中文 |
