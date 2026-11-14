import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("帳號").fill("test-manager");
  await page.getByLabel("密碼").fill("test-password");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("未登入不能看列表頁", async ({ page }) => {
  await page.goto("/admin/submissions");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/participants");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("登入後可看報名列表與照片列表並篩選（唯讀）", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "報名者" }).click();
  await expect(page.getByRole("heading", { name: "報名列表" })).toBeVisible();
  await expect(page.getByText("假員工一")).toBeVisible();
  await expect(page.getByText("T0002")).toBeVisible();

  await page.getByRole("link", { name: "照片" }).click();
  await expect(page.getByRole("heading", { name: "照片列表" })).toBeVisible();
  await expect(page.getByText("共 4 筆")).toBeVisible();

  await page.getByLabel("狀態").selectOption("rejected");
  await page.getByRole("button", { name: "篩選" }).click();
  await expect(page.getByText("共 1 筆")).toBeVisible();
  await expect(page.getByRole("cell", { name: "照片模糊" })).toBeVisible();

  // 唯讀：沒有審核／刪除按鈕
  await expect(page.getByRole("button", { name: /通過|退件|刪除/ })).toHaveCount(0);
});
