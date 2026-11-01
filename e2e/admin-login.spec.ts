import { expect, test } from "@playwright/test";

test("未登入存取 /admin 會導向登入頁", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "後台登入" })).toBeVisible();
});

test("未登入存取 /api/admin/** 回 401", async ({ request }) => {
  const res = await request.get("/api/admin/photos/1", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test("偽造 cookie 不能進入後台", async ({ page, context }) => {
  await context.addCookies([
    { name: "admin_session", value: "forged.value", url: "http://localhost:3100" },
  ]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("錯誤密碼顯示錯誤並留在登入頁", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("帳號").fill("test-manager");
  await page.getByLabel("密碼").fill("wrong");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByText("帳號或密碼錯誤")).toBeVisible();
  await expect(page.locator("p[role=alert]")).toHaveText("帳號或密碼錯誤");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("登入後可進入後台，登出後再被擋", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("帳號").fill("test-manager");
  await page.getByLabel("密碼").fill("test-password");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("E0001 測試主管")).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
