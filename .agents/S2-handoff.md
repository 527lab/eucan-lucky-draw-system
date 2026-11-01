# S2 交接

## 做了什麼
- `src/lib/db/schema.ts`：spec §6 全部表、enum、索引；`draw_runs` 的 partial unique index（`(true) WHERE status <> 'cancelled'`）；`prizes.quantity > 0` CHECK。未建 employees／employee_bind_*。
- `drizzle/0000_init.sql`（drizzle-kit 產生）；`pnpm db:generate | db:migrate | db:seed`（`scripts/db.ts`，需 `DATABASE_URL`）。
- `src/lib/db/client.ts`：`createDb()`——有 `DATABASE_URL` 用 `pg`，無且 `APP_ENV=test` 用 PGlite；`runMigrations()`、`getDb()`；共用型別 `Db`。
- `src/lib/db/seed.ts`：3 個範例景點、3 個範例獎品（已有資料則不重複建立）。
- `src/lib/settings/`：`schema.ts`（zod + 預設值，spec §7.2；另加 `privacy.purgeAfterDays`）、`index.ts`（`getSettings(db)`、`updateSetting(db, key, value, actor)`，錯誤類別 `SettingsValidationError`、`SettingsLockedError`）。
- 測試 helper：`src/lib/db/test-helper.ts` 的 `createTestDb()`（全新 PGlite + migration）。
- 測試 19 項（含 line_message_id、webhook_event_id、employee_no、draw_runs 唯一性）。
- CI 加 Postgres 17 service，執行 `db:migrate && db:seed`。

## 驗證
lint、typecheck、test、build 本機通過。**本機沒有 Docker／Postgres，真實 Postgres 的 migration 只由 CI 驗證**，請看 PR 的 CI 結果。

## 決策／注意
- `updateSetting`/`getSettings` 第一個參數是 `db`（規格沒寫，但需要連線）。
- 「鎖定」= 存在任何非 cancelled 的 draw_run（locked／drawn／announced），比字面「locked」更嚴；符合 §7.3 「必須先取消才能修改」。
- DB 內無效的設定值讀取時退回預設值，不拋錯。
- 設定鍵為扁平點號字串（如 `ticket.mode`）。
- `submissions.created_at` 預設 now()，S5 寫入時需帶 LINE timestamp。
- `pnpm install` 提示 esbuild 建置腳本被略過，`tsx` 與 drizzle-kit 實測可用。
- 首頁仍用 `DEFAULT_EVENT_NAME`，尚未改讀 settings。

## 下一步
S3 之後。
