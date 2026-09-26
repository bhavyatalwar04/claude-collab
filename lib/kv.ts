// Minimal key-value layer: Upstash Redis in production, in-memory for local dev.
import { Redis } from "@upstash/redis";

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrangeAfter(key: string, afterScore: number): Promise<string[]>;
  ztrim(key: string, keepLast: number): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
}

function redisKV(url: string, token: string): KV {
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: (k) => r.get<string>(k),
    set: async (k, v) => void (await r.set(k, v)),
    incr: (k) => r.incr(k),
    hset: async (k, f, v) => void (await r.hset(k, { [f]: v })),
    hget: (k, f) => r.hget<string>(k, f),
    hgetall: async (k) => {
      // Without automatic deserialization Upstash returns HGETALL as a flat [field, value, ...] array.
      const raw = (await r.hgetall(k)) as unknown as string[] | Record<string, string> | null;
      if (!raw) return {};
      if (!Array.isArray(raw)) return raw;
      const out: Record<string, string> = {};
      for (let i = 0; i + 1 < raw.length; i += 2) out[raw[i]] = raw[i + 1];
      return out;
    },
    hdel: async (k, f) => void (await r.hdel(k, f)),
    zadd: async (k, score, member) => void (await r.zadd(k, { score, member })),
    zrangeAfter: (k, after) => r.zrange<string[]>(k, `(${after}`, "+inf", { byScore: true }),
    ztrim: async (k, keep) => void (await r.zremrangebyrank(k, 0, -(keep + 1))),
    expire: async (k, s) => void (await r.expire(k, s)),
  };
}

type ZEntry = { score: number; member: string };
type Mem = { strings: Map<string, string>; hashes: Map<string, Map<string, string>>; zsets: Map<string, ZEntry[]> };

function memoryKV(): KV {
  const g = globalThis as unknown as { __collabMem?: Mem };
  const m = (g.__collabMem ??= { strings: new Map(), hashes: new Map(), zsets: new Map() });
  const hash = (k: string): Map<string, string> => m.hashes.get(k) ?? m.hashes.set(k, new Map()).get(k)!;
  const zset = (k: string): ZEntry[] => m.zsets.get(k) ?? m.zsets.set(k, []).get(k)!;
  return {
    get: async (k) => m.strings.get(k) ?? null,
    set: async (k, v) => void m.strings.set(k, v),
    incr: async (k) => {
      const n = Number(m.strings.get(k) ?? 0) + 1;
      m.strings.set(k, String(n));
      return n;
    },
    hset: async (k, f, v) => void hash(k).set(f, v),
    hget: async (k, f) => hash(k).get(f) ?? null,
    hgetall: async (k) => Object.fromEntries(hash(k)),
    hdel: async (k, f) => void hash(k).delete(f),
    zadd: async (k, score, member) => {
      const z = zset(k);
      z.push({ score, member });
      z.sort((a, b) => a.score - b.score);
    },
    zrangeAfter: async (k, after) => zset(k).filter((e) => e.score > after).map((e) => e.member),
    ztrim: async (k, keep) => {
      const z = zset(k);
      if (z.length > keep) z.splice(0, z.length - keep);
    },
    expire: async () => {},
  };
}

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const kv: KV = url && token ? redisKV(url, token) : memoryKV();
export const usingMemory = !(url && token);
