import type { Db } from "./client";
import { prizes, spots } from "./schema";

/** 範例資料：3 個景點、3 個獎品（皆為虛構，不含個資）。重複執行不會重複建立。 */
export const SAMPLE_SPOTS = [
  { name: "範例景點 A", description: "範例資料，請於後台修改", sortOrder: 1 },
  { name: "範例景點 B", description: "範例資料，請於後台修改", sortOrder: 2 },
  { name: "範例景點 C", description: "範例資料，請於後台修改", sortOrder: 3 },
];

export const SAMPLE_PRIZES = [
  { name: "範例頭獎", quantity: 1, drawOrder: 1 },
  { name: "範例二獎", quantity: 2, drawOrder: 2 },
  { name: "範例三獎", quantity: 3, drawOrder: 3 },
];

export async function seed(db: Db): Promise<{ spots: number; prizes: number }> {
  const hasSpots = (await db.select({ id: spots.id }).from(spots).limit(1)).length > 0;
  const hasPrizes = (await db.select({ id: prizes.id }).from(prizes).limit(1)).length > 0;
  if (!hasSpots) await db.insert(spots).values(SAMPLE_SPOTS);
  if (!hasPrizes) await db.insert(prizes).values(SAMPLE_PRIZES);
  return {
    spots: hasSpots ? 0 : SAMPLE_SPOTS.length,
    prizes: hasPrizes ? 0 : SAMPLE_PRIZES.length,
  };
}
