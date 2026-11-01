import { validateSignature } from "@line/bot-sdk";
import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "./signature";

const SECRET = "test-secret-not-real";
const BODY = JSON.stringify({ destination: "U1", events: [] });

describe("signature", () => {
  it("與官方 SDK 的演算法一致", () => {
    const sig = computeSignature(BODY, SECRET);
    expect(validateSignature(BODY, SECRET, sig)).toBe(true);
    expect(verifySignature(BODY, sig, SECRET)).toBe(true);
  });

  it("body 被改動、secret 錯誤、簽章缺漏或長度不同皆失敗", () => {
    const sig = computeSignature(BODY, SECRET);
    expect(verifySignature(BODY + " ", sig, SECRET)).toBe(false);
    expect(verifySignature(BODY, sig, "other-secret")).toBe(false);
    expect(verifySignature(BODY, null, SECRET)).toBe(false);
    expect(verifySignature(BODY, "", SECRET)).toBe(false);
    expect(verifySignature(BODY, "short", SECRET)).toBe(false);
    expect(verifySignature(BODY, sig, undefined)).toBe(false);
  });
});
