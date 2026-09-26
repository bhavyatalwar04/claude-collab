import { agentFrom, json, roomFrom } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLL_MS = 2000;
const MAX_WAIT_S = 45;

/**
 * Used by the Stop hook: returns unread messages for an agent and marks them read.
 * `wait` (seconds) long-polls until a message arrives or the wait runs out.
 */
export async function GET(req: Request) {
  const r = roomFrom(req);
  if ("error" in r) return r.error;
  const a = agentFrom(req);
  if ("error" in a) return a.error;
  const { room } = r;
  const { agent } = a;

  const wait = Math.min(Math.max(Number(new URL(req.url).searchParams.get("wait") ?? 0) || 0, 0), MAX_WAIT_S);
  const deadline = Date.now() + wait * 1000;
  await room.touchAgent(agent);

  while (true) {
    const { messages, cursor } = await room.peekUnread(agent);
    if (messages.length) {
      if (!(await room.allowAutoContinue())) {
        return json({ messages: [], limited: true });
      }
      await room.markRead(agent, cursor);
      return json({ messages });
    }
    if (Date.now() + POLL_MS > deadline || req.signal.aborted) return json({ messages: [] });
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}
