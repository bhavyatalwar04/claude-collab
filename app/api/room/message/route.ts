import { json, roomFrom } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The human posts a message into the room from the web page. */
export async function POST(req: Request) {
  const r = roomFrom(req);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => null)) as { to?: string; text?: string } | null;
  const to = body?.to?.trim() || "all";
  const text = body?.text?.trim();
  if (!text) return json({ error: "Message text is required." }, 400);
  if (text.length > 20000) return json({ error: "Message is too long." }, 400);
  const message = await r.room.send("human", to, text);
  return json({ message });
}
