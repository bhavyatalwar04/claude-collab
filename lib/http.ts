import { Room, validateAgentName, validateKey } from "./room";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Reads the room key from the X-Room-Key header (or ?room= as a fallback). */
export function roomFrom(req: Request): { room: Room } | { error: Response } {
  const key = req.headers.get("x-room-key") ?? new URL(req.url).searchParams.get("room");
  const err = validateKey(key);
  if (err) return { error: json({ error: err }, 401) };
  return { room: new Room(key!) };
}

/** Reads the agent name from the X-Agent header (or ?agent= as a fallback). */
export function agentFrom(req: Request): { agent: string } | { error: Response } {
  const agent = req.headers.get("x-agent") ?? new URL(req.url).searchParams.get("agent");
  const err = validateAgentName(agent);
  if (err) return { error: json({ error: err }, 400) };
  return { agent: agent! };
}
