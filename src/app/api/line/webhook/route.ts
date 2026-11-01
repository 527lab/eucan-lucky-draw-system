import { after } from "next/server";
import { installRegistrationHandler } from "@/lib/employees/register";
import { getDb } from "@/lib/db/client";
import { getLineClient } from "@/lib/line/client";
import { receiveWebhook } from "@/lib/line/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

installRegistrationHandler();

export async function POST(req: Request) {
  // 必須用原始 body 驗簽，不可先 parse 再序列化。
  const rawBody = await req.text();
  const result = await receiveWebhook(rawBody, req.headers.get("x-line-signature"), {
    db: await getDb(),
    client: getLineClient,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    schedule: (task) => after(task),
  });
  return Response.json(result.body, { status: result.status });
}
