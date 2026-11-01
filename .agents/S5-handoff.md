# S5 交接

## 做了什麼
- `src/lib/domain/entitlements.ts`：純函式 `computeEntitlements(settings, participants, approvedSubmissions, spots, adjustments) → Map<participantId, {tickets, completedSpotIds, eligible}>`。
  - **與 tasks.md 簽章的差異**：多了 `participants` 參數（需要 status 才能處理停權／封鎖 OA）。
  - eslint 用 `no-restricted-imports`／`no-restricted-globals`／`no-restricted-properties` 禁止該檔引入 db、fs、網路、`Date`、`Math.random`（已手動驗證違規會報錯）。
- `src/lib/domain/entitlements-db.ts`：`loadEntitlements`（讀 DB 後呼叫純函式）、`ticketsFor`。
- S4 的 `upload/index.ts`、`progress.ts` 改用 `ticketsFor`；已刪除 `tickets-provisional.ts`。
- 測試：`entitlements.test.ts`（三模式 × 無照片／重複景點／counts_for_ticket=false／required=false／maxPerUser／負調整歸零／unfollowed（keep 開關）／blocked／未報名）＋ `entitlements-db.test.ts`（PGlite 整合，含改 ticket.mode 後結果改變）。共 145 項全過；此檔覆蓋率 100%（statements／branches／functions／lines）。
- 新增 devDependency `@vitest/coverage-v8`（版本同 vitest），用 `pnpm exec vitest run --coverage --coverage.include=src/lib/domain/entitlements.ts` 量測。

## 驗證
lint、typecheck、test、build 本機通過。資料全為 fixture，未讀寫真實資料；無 LINE 呼叫。

## 我採用的假設（需 David 確認）
1. **「被停權者」＝`participants.status = blocked`**（S3b 的 `suspendParticipant`）：券數恆為 0，含手動調整。**「封鎖者」＝`unfollowed`**，依 `ticket.keepOnUnfollow`。`pending_registration` 也一律 0 張。
2. `maxPerUser` 上限套用於三種模式（規格表只寫 per_spot），沿用 S4 暫用函式行為；上限在手動調整**之前**套用，調整後只保證 ≥ 0。
3. 手動調整是否受上限限制？目前**不受**（管理員明確加的券不被吃掉）。
4. `complete_all` 的「必填景點」＝`active && required && countsForTicket`；沒有任何必填景點時為 0 張（不是恆真）。停用景點已通過的照片仍計入 per_spot／threshold（不因停用而丟券）。
5. 沒照片但有正的手動調整 → 合格（eligible＝tickets>0）。
6. 只計 `approved`；`pending_spot`／`pending_review`／`rejected` 與 spotId 為 null 皆忽略。

## S4 交接問題（未處理，維持原樣，仍待 David 決定）
照片保存位置與保存期限／備份、景點種子資料、路徑 A 選景點粒度、圖片大小限制、多張照片回覆次數、失敗事件重試排程、loading 動畫開關。S5 不涉及這些，沒有改動。

## 後續（S6／S7）
- S6 審核頁退件後直接呼叫 `loadEntitlements` 即可立即反映；儀表板可用不帶 participantId 的版本（全員一次計算，量大時再考慮分頁）。
- S7 鎖定獎池請把 `computeEntitlements` 的結果存入 `pool_snapshot`。
