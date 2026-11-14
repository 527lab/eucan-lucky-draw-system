# S7 交接（後台管理畫面第一刀：唯讀列表）

## 做了什麼
- `src/lib/admin/queries.ts`：唯讀查詢 `listSubmissions`（狀態／景點篩選、新到舊、limit 預設 200）、`listParticipants`（含照片數、已通過數；limit 預設 500）、`listSpotOptions`、`parseSubmissionStatus`。只有 SELECT。
- 頁面：`/admin/participants`（報名列表）、`/admin/submissions`（照片列表，GET 表單篩選狀態／景點）、共用 `AdminNav`，`/admin` 首頁加導覽。各頁自行呼叫 `getAdminSession()` 再確認（proxy 只是樂觀檢查）。無審核／刪除／抽獎操作、無 LINE 呼叫。
- 假資料：`src/lib/db/fixtures.ts`（全虛構）。僅在 `APP_ENV=test` 且 `ADMIN_FIXTURES=1` 時由 `getDb()` 載入記憶體 PGlite；`playwright.config.ts` 設了該變數。
- 測試：`queries.test.ts` 7 項（PGlite）；E2E `admin-lists.spec.ts` 2 項（未登入被擋；登入→報名列表→照片列表→篩選→確認無審核按鈕）。

## 驗證
lint（0 error；僅 coverage/ 產物 1 個既有 warning）、typecheck、vitest 189 項、Playwright 8 項、build 本機皆通過。

## 未完成／刻意不做
- 照片只列出中繼資料，**沒有縮圖**（`/api/admin/photos/[id]` 串流尚未做）。
- 沒有搜尋、分頁（目前只用 limit 截斷）、參加者詳情、審核、停權、手動加減券、儀表板統計。
- 時間以 UTC 顯示（`YYYY-MM-DD HH:mm`），未轉時區。

## 待 David 決定
1. 列表是否要顯示縮圖？照片保存位置與存取權限（沿用 S4 未決事項）決定串流 API 設計。
2. 後台顯示時區（建議 Asia/Taipei，但未擅自決定）。
3. 列表量大時的分頁／搜尋方式。
4. 是否把 Playwright 加進 CI（承 S6b）。
5. PR base 為 s6-next（依指示）；s6-next 本身的 PR #8 合併順序請 David 安排。
