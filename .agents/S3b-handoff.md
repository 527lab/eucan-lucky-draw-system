# S3b 交接

## 做了什麼
- `src/lib/employees/verifier.ts`：`EmployeeVerifier`、`VerifierUnavailableError`、`normalizeEmployeeNo`（NFKC＋trim；擋空、含空白／控制字元、>32 字元；不訂格式、不改大小寫）。
- `register-parse.ts`／`register.ts`：`parseRegistration`（指令＋編號，空白可有可無、全形半形皆可）、`registerEmployee`（查證→UPDATE，並發靠 `participants.employee_no` UNIQUE，23505 → taken）、`handleRegistration`、`installRegistrationHandler()`（把處理函式掛到 `registrationHandler.current`；在 `POST /api/line/webhook` route 模組載入時呼叫）。
- `adapters.ts`：`csv`（查 `employee_allowlist`）、`mock`、`leave-api`（GET `/api/integrations/employees/{no}/status`，Bearer，3 秒逾時；非 200、逾時、網路錯誤、非 JSON、`valid` 非布林、缺 `LEAVE_API_*` 一律 `VerifierUnavailableError`，不放行）。`factory.ts` 依 `employees.source` 選轉接器（預設 `csv`，leave-api 未啟用）。
- `admin.ts`（函式庫，尚無 UI）：`parseAllowlistCsv`／`replaceAllowlist`（單欄 CSV 覆蓋名單；空名單拒絕；稽核只記數量）、`suspendParticipant`（blocked＋釋出 `employee_no`＋稽核）。
- 訊息：用法、成功、無效（通用）、編號已被使用、系統忙碌、已報名（換編號）、停權者；未通過查證者傳圖片 → 回「請先完成報名」，不建立 submission（`handlers/message.ts`）。
- 測試 `src/lib/employees/employees.test.ts`（含本機 HTTP mock server 的逾時／5xx 測試、並發搶同編號、停權釋出、webhook 端到端、log 無個資），並更新 S3 的圖片測試。共 80 項。

## 驗證
lint、typecheck、test、build 本機通過。員工資料全為測試 fixture（A1234 等虛構編號）；金鑰只讀 `LEAVE_API_BASE_URL`／`LEAVE_API_TOKEN` 環境變數，測試用假值。本機無 Docker／真實 OA，未實機驗證。

## 未完成／需要決定
1. **後台 `/admin/employees` 頁面、參加者停權按鈕、中獎名單顯示員工編號未做 UI**：後台登入（S6）與抽獎（S7）都還不存在，不能做出沒有驗證的管理頁。已把 `replaceAllowlist`、`suspendParticipant` 做成函式庫並有測試，S6 接 UI 即可；S7 中獎名單請 join `participants.employee_no`。若 David 想先要一個臨時匯入方式（例如 script），請告知。
2. **真實員工名單來源**：csv 轉接器只提供介面與上傳函式，名單由 David／HR 提供後經後台匯入，我沒有放入或讀取任何真實名單。
3. 編號比對**區分大小寫**（`a1234` ≠ `A1234`）。是否要不分大小寫，需依請假系統實際格式決定。
4. 已報名者輸入「參加 別的編號」回「已報名，如需更換請聯絡福委／HR」，不自動換綁（規格未定義，採保守做法）。
5. 任何以指令字開頭的文字（例如「參加活動」）都視為報名嘗試，回通用「查無此員工編號」；leave-api 模式下會多打一次查證 API。
6. leave-api 的實際契約（路徑、速率限制）仍待請假系統確認；`LEAVE_API_BASE_URL`／`LEAVE_API_TOKEN` 未新增鍵名（S1 已有）。
