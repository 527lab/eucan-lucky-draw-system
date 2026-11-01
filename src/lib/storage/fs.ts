import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoStorage } from "./index";
import { assertValidKey, InvalidStorageKeyError } from "./index";

/** 本機檔案系統實作（Docker volume）。額外以 resolve 後的前綴檢查防止路徑穿越。 */
export class FsPhotoStorage implements PhotoStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new InvalidStorageKeyError(key);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string) {
    try {
      const data = await readFile(this.resolve(key));
      return { data, contentType: "image/jpeg" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
