import { createHmac, timingSafeEqual } from "node:crypto";

/** 以 channel secret 對「原始 body」做 HMAC-SHA256 並 Base64 編碼（LINE 簽章演算法）。 */
export function computeSignature(rawBody: string | Buffer, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody).digest("base64");
}

/** 以 timingSafeEqual 驗證 x-line-signature；缺少簽章或 secret 一律視為失敗。 */
export function verifySignature(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  channelSecret: string | undefined,
): boolean {
  if (!signature || !channelSecret) return false;
  const expected = Buffer.from(computeSignature(rawBody, channelSecret));
  const actual = Buffer.from(signature);
  // timingSafeEqual 要求長度相同；長度不同必定不符（長度本身不是機密）。
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
