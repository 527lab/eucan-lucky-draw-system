/** 伺服器啟動時驗證環境變數；缺值會讓啟動失敗並列出缺少的鍵。 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./env");
    getEnv();
  }
}
