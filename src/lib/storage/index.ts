import { randomUUID } from "node:crypto";
import path from "node:path";
import { FsPhotoStorage } from "./fs";

/** 照片儲存介面；業務程式只依賴它，之後換 S3／R2 只需新增實作（architecture.md §1）。 */
export interface PhotoStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`無效的 storage key: ${JSON.stringify(key).slice(0, 80)}`);
    this.name = "InvalidStorageKeyError";
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^photos/${UUID}/${UUID}\.jpg$`);

/** key 格式固定為 photos/<participantId>/<uuid>.jpg；其他形式（含 ..、絕對路徑、反斜線）一律拒絕。 */
export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key)) throw new InvalidStorageKeyError(key);
}

export function newPhotoKey(participantId: string): string {
  const key = `photos/${participantId}/${randomUUID()}.jpg`;
  assertValidKey(key);
  return key;
}

let shared: PhotoStorage | undefined;
/** 依 PHOTO_STORAGE_DIR 建立本機檔案系統實作（路徑只從環境變數讀取）。 */
export function getStorage(): PhotoStorage {
  if (!shared) {
    const dir = process.env.PHOTO_STORAGE_DIR;
    if (!dir) throw new Error("PHOTO_STORAGE_DIR 未設定");
    shared = new FsPhotoStorage(path.resolve(dir));
  }
  return shared;
}

export { FsPhotoStorage } from "./fs";
export { MemoryPhotoStorage } from "./memory";
