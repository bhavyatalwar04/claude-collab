"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Agent = { name: string; lastSeen: number; online: boolean };
type Message = { id: number; from: string; to: string; text: string; at: number };
type ContextEntry = { key: string; content: string; by: string; at: number };

const STORAGE_KEY = "collab-room-key";
const POLL_MS = 3000;

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const s = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  return s.match(/.{4}/g)!.join("-");
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function Home() {
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRoomKey(load(STORAGE_KEY));
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!roomKey)
    return (
      <Start
        onJoin={(k) => {
          save(STORAGE_KEY, k);
          setRoomKey(k);
        }}
      />
    );
  return (
    <RoomView
      roomKey={roomKey}
      onLeave={() => {
        save(STORAGE_KEY, null);
        setRoomKey(null);
      }}
    />
  );
}

function Start({ onJoin }: { onJoin: (key: string) => void }) {
  const [key, setKey] = useState("");
  const valid = key.trim().length >= 12;
  return (
    <main className="start">
      <h1>Claude Collab</h1>
      <p className="muted">
        A shared room where Claude sessions on different accounts and computers talk to each other and share context.
        Everyone who uses the same room key is in the same room.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onJoin(key.trim());
        }}
      >
        <input
          type="password"
          placeholder="Room key (min 12 characters)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <button className="primary" disabled={!valid}>
          Enter
        </button>
      </form>
      <button type="button" onClick={() => setKey(generateKey())}>
        Generate a new room key
      </button>
      {key && valid && (
        <p className="small muted">
          Key: <code>{key}</code>. Save it; it is the only way into this room.
        </p>
      )}
    </main>
  );
}

function RoomView({ roomKey, onLeave }: { roomKey: string; onLeave: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [context, setContext] = useState<ContextEntry[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/room?since=${lastId.current}`, {
        headers: { "x-room-key": roomKey },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAgents(data.agents);
      setContext(data.context);
      if (data.messages.length) {
        lastId.current = data.messages[data.messages.length - 1].id;
        setMessages((prev) => [...prev, ...data.messages]);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [roomKey]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="room">
      <header className="topbar">
        <h1>Claude Collab</h1>
        <span className="small muted">
          Room key: <code>{showKey ? roomKey : "•".repeat(12)}</code>{" "}
          <button className="small" style={{ padding: "2px 8px" }} onClick={() => setShowKey((s) => !s)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </span>
        <span className="spacer" />
        {error && <span className="small error">{error}</span>}
        <button onClick={onLeave}>Leave room</button>
      </header>

      <div className="grid">
        <div className="side">
          <section className="panel">
            <h2>Agents</h2>
            <div className="body">
              {agents.length === 0 && <p className="muted small">No agents yet. Connect one below.</p>}
              {agents.map((a) => (
                <div className="agent" key={a.name}>
                  <span className={`dot ${a.online ? "on" : ""}`} />
                  <strong>{a.name}</strong>
                  <span className="small muted">{ago(a.lastSeen)}</span>
                </div>
              ))}
            </div>
          </section>
          <Connect roomKey={roomKey} />
        </div>

        <section className="panel chat">
          <h2>Messages</h2>
          <div className="body" ref={scroller}>
            {messages.length === 0 && <p className="muted small">No messages yet.</p>}
            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.from === "human" ? "human" : ""}`}>
                  <div className="meta">
                    <span className="from">{m.from}</span>
                    <span className="muted">→ {m.to}</span>
                    <span className="muted">{time(m.at)}</span>
                  </div>
                  <div className="text">{m.text}</div>
                </div>
              ))}
            </div>
          </div>
          <Composer roomKey={roomKey} agents={agents} onSent={poll} />
        </section>

        <section className="panel">
          <h2>Shared context</h2>
          <div className="body">
            {context.length === 0 && <p className="muted small">Nothing shared yet.</p>}
            {context.map((c) => (
              <details className="ctx" key={c.key} open>
                <summary>
                  {c.key} <span className="small muted">· {c.by} · {ago(c.at)}</span>
                </summary>
                <div className="text">{c.content}</div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Composer({ roomKey, agents, onSent }: { roomKey: string; agents: Agent[]; onSent: () => void }) {
  const [to, setTo] = useState("all");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/room/message", {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-key": roomKey },
        body: JSON.stringify({ to, text }),
      });
      if (res.ok) {
        setText("");
        onSent();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <textarea
        rows={3}
        placeholder="Message the agents as human… (Ctrl+Enter to send)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
      />
      <div className="row">
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="all">To: all</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              To: {a.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={send} disabled={sending || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

function Connect({ roomKey }: { roomKey: string }) {
  const [name, setName] = useState("alice");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const agent = name.trim() || "alice";
  const mcp = `claude mcp add --transport http collab ${origin}/api/mcp --header "X-Room-Key: ${roomKey}" --header "X-Agent: ${agent}"`;
  const download = `mkdir -p .claude && curl -fsSL ${origin}/collab-hook.mjs -o .claude/collab-hook.mjs`;
  const settings = JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `node .claude/collab-hook.mjs --url ${origin} --room ${roomKey} --agent ${agent} --wait 90`,
                timeout: 150,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
  const prompt = `You are "${agent}" in a shared collab room (tools: mcp__collab__*). Call list_agents and get_context first, then coordinate the task with the other agents through send_message and keep shared context updated with share_context.`;

  return (
    <section className="panel">
      <h2>Connect a session</h2>
      <div className="body connect">
        <label>Agent name for this computer</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />

        <label>1 · Add the MCP server (run in the project folder)</label>
        <pre className="cmd">{mcp}</pre>

        <label>2 · Optional auto-reply hook: download it</label>
        <pre className="cmd">{download}</pre>

        <label>…then put this in .claude/settings.local.json</label>
        <pre className="cmd">{settings}</pre>

        <label>3 · First prompt for the session</label>
        <pre className="cmd">{prompt}</pre>
      </div>
    </section>
  );
}
