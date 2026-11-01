import { expect, test } from "@playwright/test";

test("首頁顯示活動名稱", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "EUCAN 2027 員工旅遊",
  );
});
