import { createHash } from "node:crypto";
import { kv } from "./kv";

export const TTL_SECONDS = 30 * 24 * 3600;
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const MAX_MESSAGES = 500;
export const AUTO_CONTINUE_LIMIT_PER_HOUR = 50;

export type Agent = { name: string; joinedAt: number; lastSeen: number; online: boolean };
export type Message = { id: number; from: string; to: string; text: string; at: number };
export type ContextEntry = { key: string; content: string; by: string; at: number };

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const RESERVED = new Set(["all", "human"]);

export function validateKey(key: string | null | undefined): string | null {
  if (!key) return "Missing room key (X-Room-Key header).";
  if (key.length < 12) return "Room key must be at least 12 characters.";
  if (key.length > 200) return "Room key is too long.";
  return null;
}

export function validateAgentName(name: string | null | undefined): string | null {
  if (!name) return "Missing agent name (X-Agent header).";
  if (!NAME_RE.test(name)) return "Agent name may only contain letters, numbers, - and _ (max 32).";
  if (RESERVED.has(name.toLowerCase())) return `"${name}" is reserved.`;
  return null;
}

/** A room is addressed by a hash of its key, so the key itself is never stored. */
export class Room {
  private readonly p: string;

  constructor(key: string) {
    this.p = `room:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  }

  private k(suffix: string) {
    return `${this.p}:${suffix}`;
  }

  private async bump(...extra: string[]) {
    const keys = ["agents", "messages", "seq", "context", ...extra].map((s) => this.k(s));
    await Promise.all(keys.map((key) => kv.expire(key, TTL_SECONDS)));
  }

  async touchAgent(name: string) {
    const now = Date.now();
    const existing = await kv.hget(this.k("agents"), name);
    const joinedAt = existing ? (JSON.parse(existing).joinedAt as number) : now;
    await kv.hset(this.k("agents"), name, JSON.stringify({ joinedAt, lastSeen: now }));
    await this.bump(`read:${name}`);
  }

  async listAgents(): Promise<Agent[]> {
    const raw = await kv.hgetall(this.k("agents"));
    const now = Date.now();
    return Object.entries(raw)
      .map(([name, v]) => {
        const { joinedAt, lastSeen } = JSON.parse(v);
        return { name, joinedAt, lastSeen, online: now - lastSeen < ONLINE_WINDOW_MS };
      })
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async send(from: string, to: string, text: string): Promise<Message> {
    const id = await kv.incr(this.k("seq"));
    const msg: Message = { id, from, to, text, at: Date.now() };
    await kv.zadd(this.k("messages"), id, JSON.stringify(msg));
    await kv.ztrim(this.k("messages"), MAX_MESSAGES);
    await this.bump();
    return msg;
  }

  async messagesSince(since: number): Promise<Message[]> {
    const raw = await kv.zrangeAfter(this.k("messages"), since);
    return raw.map((m) => JSON.parse(m) as Message);
  }

  /** Unread messages addressed to `name` (or to all), excluding its own. */
  async peekUnread(name: string): Promise<{ messages: Message[]; cursor: number }> {
    const cursor = Number((await kv.get(this.k(`read:${name}`))) ?? 0);
    const all = await this.messagesSince(cursor);
    const lower = name.toLowerCase();
    const messages = all.filter(
      (m) => m.from.toLowerCase() !== lower && (m.to === "all" || m.to.toLowerCase() === lower),
    );
    const latest = all.length ? all[all.length - 1].id : cursor;
    return { messages, cursor: latest };
  }

  async markRead(name: string, cursor: number) {
    await kv.set(this.k(`read:${name}`), String(cursor));
    await kv.expire(this.k(`read:${name}`), TTL_SECONDS);
  }

  async setContext(key: string, content: string, by: string) {
    if (content.trim() === "") {
      await kv.hdel(this.k("context"), key);
    } else {
      await kv.hset(this.k("context"), key, JSON.stringify({ content, by, at: Date.now() }));
    }
    await this.bump();
  }

  async getContext(): Promise<ContextEntry[]> {
    const raw = await kv.hgetall(this.k("context"));
    return Object.entries(raw)
      .map(([key, v]) => ({ key, ...(JSON.parse(v) as Omit<ContextEntry, "key">) }))
      .sort((a, b) => b.at - a.at);
  }

  /** Counts hook-driven auto-continues; returns false once the hourly limit is reached. */
  async allowAutoContinue(): Promise<boolean> {
    const bucket = this.k(`auto:${Math.floor(Date.now() / 3_600_000)}`);
    const current = Number((await kv.get(bucket)) ?? 0);
    if (current >= AUTO_CONTINUE_LIMIT_PER_HOUR) return false;
    await kv.incr(bucket);
    await kv.expire(bucket, 3600);
    return true;
  }
}
