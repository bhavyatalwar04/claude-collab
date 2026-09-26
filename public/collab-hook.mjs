#!/usr/bin/env node
// Claude Code Stop hook for claude-collab.
// When the session is about to stop, checks the room inbox. If there are new
// messages, it blocks the stop and hands them to Claude so the conversation continues.
//
// Usage (in .claude/settings.local.json):
//   node .claude/collab-hook.mjs --url https://<app>.vercel.app --room <key> --agent <name> [--wait 90]
// Or set COLLAB_URL, COLLAB_ROOM_KEY, COLLAB_AGENT, COLLAB_WAIT instead of flags.

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}
const url = (args.url ?? process.env.COLLAB_URL ?? "").replace(/\/+$/, "");
const room = args.room ?? process.env.COLLAB_ROOM_KEY;
const agent = args.agent ?? process.env.COLLAB_AGENT;
const waitSeconds = Number(args.wait ?? process.env.COLLAB_WAIT ?? 0) || 0;

// Drain the hook input from stdin (not needed, but keeps the pipe clean).
process.stdin.resume();
process.stdin.on("data", () => {});

async function main() {
  if (!url || !room || !agent) {
    console.error("collab-hook: missing --url, --room or --agent");
    return;
  }
  const deadline = Date.now() + waitSeconds * 1000;
  do {
    const wait = Math.max(0, Math.min(40, Math.round((deadline - Date.now()) / 1000)));
    let data;
    try {
      const res = await fetch(`${url}/api/room/inbox?agent=${encodeURIComponent(agent)}&wait=${wait}`, {
        headers: { "x-room-key": room },
      });
      if (!res.ok) {
        console.error(`collab-hook: inbox request failed (${res.status})`);
        return;
      }
      data = await res.json();
    } catch (err) {
      console.error(`collab-hook: ${err.message}`);
      return;
    }
    if (data.limited) {
      console.error("collab-hook: hourly auto-continue limit reached; letting the session stop.");
      return;
    }
    if (data.messages?.length) {
      const body = data.messages
        .map((m) => `#${m.id} ${m.from} → ${m.to === agent ? "you" : m.to}:\n${m.text}`)
        .join("\n\n");
      const reason =
        `New messages in the collab room:\n\n${body}\n\n` +
        "Act on them, reply with the collab send_message tool where useful, " +
        "and update shared context with share_context when you make progress.";
      process.stdout.write(JSON.stringify({ decision: "block", reason }));
      return;
    }
  } while (Date.now() < deadline);
}

main().finally(() => process.exit(0));
