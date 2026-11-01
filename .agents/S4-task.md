# S4 照片上傳流程（sonnet）

照 `docs/tasks.md` 的「S4 照片上傳流程」章節實作，內容和驗收條件都要做到（S5 之後是別的任務，這次不要做）。

- 先 `git checkout s3b-register && git pull`，再開新分支 `s4-photo`，PR 的 base 設為 `s3b-register`。
- 讀 `.agents/S3-handoff.md`、`.agents/S3b-handoff.md`，接上已有的 webhook 與報名流程。
- 員工資料一律用假資料（測試 fixture），不能讀取或寫入任何真實員工資料或正式站資料（`eucan-prod-snapshot` 的內容）；金鑰只從環境變數讀取，LINE 呼叫在測試中一律 mock。
- 遇到需要 David 決定的地方（例如照片保存位置、景點清單），先用介面＋假資料實作，問題寫進交接，不要自己決定。
- 補單元與整合測試，lint、typecheck、test、build 都要通過；push 後確認 CI 綠燈；`gh pr create`，不要合併。
- 結束前寫 `.agents/S4-handoff.md`。