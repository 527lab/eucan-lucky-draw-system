# S6b：後台登入第二片（接續 S6）
留在 s6-next 分支（git checkout s6-next; git pull），繼續更新 PR #8。先讀 .agents/S6-task.md 與 .agents/S6-handoff.md。
這次做：middleware 保護 /admin/** 與 /api/admin/**、/admin/login 頁與 server action（接上已寫好的 loginAdmin、速率限制與 cookie）、Playwright E2E 驗證未登入會被擋、登入後可進入。照片串流路由與其他管理頁面若時間夠再做。
break-glass 帳號等設計維持現有預設，不要改；寫進交接檔讓 David 決定。

## 共同規則
- 不准把金鑰（LINE 等）、密碼、個資放進 repo；測試只用假資料與 mock，不呼叫 LINE。不亂刪檔案。
- 每完成一個小段落就 commit；push 後確認 CI 綠燈。
- 結束時更新 .agents/S6-handoff.md，最後輸出兩三句中文摘要。