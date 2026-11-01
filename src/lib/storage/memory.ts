import type { PhotoStorage } from "./index";
import { assertValidKey } from "./index";

/** 測試用 in-memory 實作；可用 failNextPut 模擬上傳失敗。 */
export class MemoryPhotoStorage implements PhotoStorage {
  readonly files = new Map<string, { data: Buffer; contentType: string }>();
  failPut = false;

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    if (this.failPut) throw new Error("storage put failed (simulated)");
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    assertValidKey(key);
    return this.files.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    assertValidKey(key);
    this.files.delete(key);
  }
}
