import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { participants, spots, submissions } from "@/lib/db/schema";

/** 後台唯讀查詢（S7）。只有 SELECT，不改資料。 */

export const SUBMISSION_STATUSES = [
  "pending_spot",
  "pending_review",
  "approved",
  "rejected",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function parseSubmissionStatus(v: string | undefined): SubmissionStatus | undefined {
  return (SUBMISSION_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as SubmissionStatus)
    : undefined;
}

export type SubmissionRow = {
  id: string;
  createdAt: Date;
  status: SubmissionStatus;
  rejectReason: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  spotName: string | null;
  displayName: string | null;
  employeeNo: string | null;
};

export async function listSubmissions(
  db: Db,
  opts: { status?: SubmissionStatus; spotId?: string; limit?: number } = {},
): Promise<SubmissionRow[]> {
  const conds = [];
  if (opts.status) conds.push(eq(submissions.status, opts.status));
  if (opts.spotId) conds.push(eq(submissions.spotId, opts.spotId));
  return db
    .select({
      id: submissions.id,
      createdAt: submissions.createdAt,
      status: submissions.status,
      rejectReason: submissions.rejectReason,
      contentType: submissions.contentType,
      sizeBytes: submissions.sizeBytes,
      spotName: spots.name,
      displayName: participants.displayName,
      employeeNo: participants.employeeNo,
    })
    .from(submissions)
    .innerJoin(participants, eq(submissions.participantId, participants.id))
    .leftJoin(spots, eq(submissions.spotId, spots.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(submissions.createdAt), asc(submissions.id))
    .limit(opts.limit ?? 200);
}

export type ParticipantRow = {
  id: string;
  displayName: string | null;
  employeeNo: string | null;
  status: string;
  registeredAt: Date | null;
  submissionCount: number;
  approvedCount: number;
};

export async function listParticipants(db: Db, opts: { limit?: number } = {}): Promise<ParticipantRow[]> {
  const rows = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      employeeNo: participants.employeeNo,
      status: participants.status,
      registeredAt: participants.registeredAt,
      submissionCount: sql<number>`count(${submissions.id})::int`,
      approvedCount: sql<number>`count(${submissions.id}) filter (where ${submissions.status} = 'approved')::int`,
    })
    .from(participants)
    .leftJoin(submissions, eq(submissions.participantId, participants.id))
    .groupBy(participants.id)
    .orderBy(desc(participants.registeredAt), asc(participants.id))
    .limit(opts.limit ?? 500);
  return rows;
}

export async function listSpotOptions(db: Db): Promise<{ id: string; name: string }[]> {
  return db.select({ id: spots.id, name: spots.name }).from(spots).orderBy(asc(spots.sortOrder), asc(spots.name));
}
