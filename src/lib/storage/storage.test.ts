import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsPhotoStorage, InvalidStorageKeyError, MemoryPhotoStorage, newPhotoKey } from "./index";

const PID = "11111111-1111-4111-8111-111111111111";

describe.each([
  ["fs", async () => new FsPhotoStorage(await mkdtemp(path.join(os.tmpdir(), "photos-")))],
  ["memory", async () => new MemoryPhotoStorage()],
])("PhotoStorage (%s)", (_name, make) => {
  let storage: Awaited<ReturnType<typeof make>>;
  beforeEach(async () => {
    storage = await make();
  });
  afterEach(async () => {
    if (storage instanceof FsPhotoStorage) {
      await rm((storage as unknown as { root: string }).root, { recursive: true, force: true });
    }
  });

  it("put / get / delete", async () => {
    const key = newPhotoKey(PID);
    expect(key).toMatch(/^photos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    expect(await storage.get(key)).toBeNull();
    await storage.put(key, Buffer.from("abc"), "image/jpeg");
    expect((await storage.get(key))?.data.toString()).toBe("abc");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await storage.delete(key); // 重複刪除不報錯
  });

  it.each([
    "../etc/passwd",
    "photos/../../x.jpg",
    "/abs/path.jpg",
    `photos/${PID}/../../x.jpg`,
    `photos\${PID}\a.jpg`,
    `photos/${PID}/x.jpg`,
    "",
  ])("拒絕危險 key %s", async (key) => {
    await expect(storage.put(key, Buffer.from("x"), "image/jpeg")).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
  });
});
