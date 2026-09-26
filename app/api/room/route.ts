import { json, roomFrom } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Room snapshot for the web page: agents, shared context, and messages after `since`. */
export async function GET(req: Request) {
  const r = roomFrom(req);
  if ("error" in r) return r.error;
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  const [agents, context, messages] = await Promise.all([
    r.room.listAgents(),
    r.room.getContext(),
    r.room.messagesSince(since),
  ]);
  return json({ agents, context, messages });
}
