# S4 交接

## 做了什麼
- `src/lib/storage/`：`PhotoStorage` 介面（put/get/delete）、`FsPhotoStorage`（路徑由 `PHOTO_STORAGE_DIR`）、`MemoryPhotoStorage`（測試，可模擬 put 失敗）。key 固定 `photos/<participantId>/<uuid>.jpg`，`assertValidKey` 嚴格比對格式＋fs 實作再做 resolve 前綴檢查，擋 `..`、絕對路徑、反斜線。
- `LineClient` 新增 `getMessageContent`（`MessagingApiBlobClient.getMessageContentWithHttpInfo`）與 `showLoading`（loading 動畫，best-effort，失敗被吞掉）。`HandlerContext` 新增 `storage()`（延遲取得）；`WebhookDeps.storage` 可注入。
- `src/lib/upload/`：
  - `handleImage`：未報名擋下 → message id 去重 → 截止／開始／抽獎鎖定檢查 → 非 `line` 來源略過並 warn → 決定景點（同 imageSet 已有景點 > 未逾時的 awaiting_photo > 無）→ 景點開放與 `maxPerSpotPerUser` 檢查 → **先下載、再存 storage、最後建 submission**（`ON CONFLICT (line_message_id) DO NOTHING`，並發重送會刪掉多存的檔）。下載或儲存失敗直接丟例外，既有的 `processEvents` 會把 `webhook_events` 標 failed 並記 error。
  - 路徑 A：`打卡` → 景點選單（≤13 Quick Reply postback，>13 Flex carousel）→ `spot:<id>` 寫 `conversation_states`（TTL＝`upload.pendingSpotTtlMinutes`）→ 傳照片。imageSet 內的照片會把 `image_set_id` 記進狀態並持續套用；下一組不同 imageSet 的照片不再沿用。
  - 路徑 B：無有效狀態 → `pending_spot` ＋ 詢問（`assign:<submissionId>:<spotId>`）；同一組只由最早的一張發問；選一次整組套用；晚到的同組照片沿用已選景點。
  - 審核模式：`auto`→approved、`manual`→pending_review；補選時若已過截止／抽獎鎖定，pending_spot 會標 `rejected`（reason＝`deadline_passed`／`draw_locked`）。
  - `postback.ts` 靜態註冊 `spot`、`assign` 路由；`message.ts` 的 `打卡`／`進度`／圖片已接上。
  - `progress.ts`：「進度」Flex（每景點 ✅／⬜、已完成數、券數、審核中張數、截止時間）。
- 測試 `upload.test.ts`（23 項）＋ `storage.test.ts`；更新 `webhook.test.ts` 中舊的「尚未開放」斷言。共 119 項。lint、typecheck、test、build 本機通過。

## 驗證限制
- 本機無 Docker／真實 OA：驗收項「測試 OA 實機：完成 2 個景點後『進度』顯示 2 個打勾」**未實機驗證**，僅以整合測試（mock LINE client＋PGlite）確認 Flex 內容有 2 個 ✅。
- 所有 LINE 呼叫皆為 mock；員工與景點資料皆為測試 fixture（A1234、日月潭等虛構資料）；未讀寫任何真實／正式站資料。

## 暫時作法（S5 要換）
- `src/lib/upload/tickets-provisional.ts` 是回覆「目前 N 張券」與進度頁用的**暫時券數函式**（三種 ticket.mode、maxPerUser；不含手動調整、封鎖／停權者處理）。S5 的 `computeEntitlements` 完成後請在 `upload/index.ts` 與 `progress.ts` 換掉並刪除此檔。

## 需要 David 決定
1. **照片實際保存位置**：目前 `FsPhotoStorage` 吃 `PHOTO_STORAGE_DIR`（Docker volume）。是否需要備份／保存期限（`privacy.purgeAfterDays` 的清除排程尚未做）？
2. **景點清單**：S4 沒有種子資料，景點需由後台（S6）建立；測試用虛構景點。
3. **一次選景點的粒度（我的假設）**：路徑 A 選一次景點只對「下一張或下一組」照片有效；要連傳第二批同景點需重新選。若希望在 TTL 內持續有效，請告知（改一行）。
4. **圖片大小／格式**：未限制大小，也不轉檔；一律以 `.jpg` 為 key 副檔名、`content_type` 記錄 LINE 回傳值。是否要上限或縮圖？
5. **多張照片的回覆**：路徑 A 的 imageSet 每張都會各回一則「已收到」（各自 replyToken）。若覺得太吵，可改成只由 imageSet 最後一張回覆（需要 `imageSet.total` 與計數）。
6. 補償掃描（`received` 狀態卡住的事件）仍未實作（S3 已提過）；照片下載失敗後 LINE 的重送會因 `webhook_events` 去重而不再處理，所以失敗的照片目前需使用者重傳——是否要加「失敗事件重試」排程？
7. loading 動畫已預設啟用（每張圖多一次 API 呼叫，速率限制遠低於上限）；若要關閉請告知。
