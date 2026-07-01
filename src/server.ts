import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import http from 'http';
import { injectKeystrokes } from "./injector";

const BROKER_PORT = parseInt(process.env.OPENPEERS_PORT || "7899", 10);
const BROKER_URL = `http://127.0.0.1:${BROKER_PORT}`;
const INJECT_PORT = process.env.OPENPEERS_INJECT_PORT ? parseInt(process.env.OPENPEERS_INJECT_PORT, 10) : null;
const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 15000;

function log(msg: string) {
  console.error(`[openpeers-mcp] ${msg}`);
}

async function brokerFetch<T>(path: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      BROKER_URL + path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      },
      (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Broker error ${res.statusCode}: ${body}`));
          } else {
            try { resolve(JSON.parse(body)); }
            catch (e) { resolve(body as any); }
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function isBrokerAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(BROKER_URL + '/health', { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function ensureBroker(): Promise<void> {
  if (await isBrokerAlive()) return;
  log("Starting broker daemon...");
  const proc = spawn("node", [path.join(__dirname, "broker.js")], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isBrokerAlive()) {
      log("Broker started");
      return;
    }
  }
  throw new Error("Failed to start broker");
}

let myId: string | null = null;
let myCwd = process.cwd();

const mcp = new Server(
  { name: "openpeers", version: "1.0.0" },
  {
    capabilities: { tools: {}, experimental: { "claude/channel": {} } },
  }
);

const TOOLS = [
  {
    name: "list_peers",
    description: "List other active agent instances on this machine.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_message",
    description: "Send a message to another agent by peer ID. The message arrives instantly and will automatically prompt them to reply.",
    inputSchema: {
      type: "object",
      properties: {
        to_id: { type: "string", description: "Target peer ID" },
        message: { type: "string", description: "The message content" }
      },
      required: ["to_id", "message"]
    }
  },
  {
    name: "set_summary",
    description: "Set a 1-2 sentence summary of what you are working on.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"]
    }
  }
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "list_peers") {
      const peers = await brokerFetch<any[]>("/list-peers", { exclude_id: myId });
      if (!peers.length) return { content: [{ type: "text", text: "No other peers found." }] };
      const lines = peers.map(p => `ID: ${p.id} | CWD: ${p.cwd} | Summary: ${p.summary || 'None'}`);
      return { content: [{ type: "text", text: `Found ${peers.length} peers:\n\n${lines.join("\n")}` }] };
    }
    if (name === "send_message") {
      const { to_id, message } = args as { to_id: string; message: string };
      await brokerFetch("/send-message", { from_id: myId, to_id, text: message });
      return { content: [{ type: "text", text: `Sent message to ${to_id}` }] };
    }
    if (name === "set_summary") {
      await brokerFetch("/set-summary", { id: myId, summary: (args as any).summary });
      return { content: [{ type: "text", text: "Summary updated." }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

async function pushToPtyWrapper(text: string) {
  if (!INJECT_PORT) return false;
  return new Promise<boolean>((resolve) => {
    const req = http.request(`http://127.0.0.1:${INJECT_PORT}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.write(JSON.stringify({ text }));
    req.end();
  });
}

async function pollMessages() {
  if (!myId) return;
  try {
    const res = await brokerFetch<{messages: any[]}>("/poll-messages", { id: myId });
    for (const msg of res.messages) {
      const content = `[Incoming from Peer ${msg.from_id}]: ${msg.text}`;
      
      // Try injection via PTY Wrapper
      if (INJECT_PORT) {
        const injected = await pushToPtyWrapper(content);
        if (injected) continue;
      }
      
      // Fallback 1: Claude Code Channels
      try {
        await mcp.notification({
          method: "notifications/claude/channel",
          params: { content: msg.text, meta: { from_id: msg.from_id } }
        });
      } catch (e) {
        // Fallback 2: OS Injector (macOS AppleScript / xdotool)
        injectKeystrokes(content).catch(err => {
          log(`Failed to inject: ${err}`);
        });
      }
    }
  } catch (e) {}
}

async function main() {
  await ensureBroker();
  
  const reg = await brokerFetch<{id: string}>("/register", {
    id: process.env.OPENPEERS_EXPECTED_PEER_ID,
    pid: process.pid,
    cwd: myCwd,
    summary: ""
  });
  myId = reg.id;
  log(`Registered as ${myId}`);

  await mcp.connect(new StdioServerTransport());
  log("MCP connected");

  setInterval(pollMessages, POLL_INTERVAL_MS);
  setInterval(() => brokerFetch("/heartbeat", { id: myId }).catch(() => {}), HEARTBEAT_INTERVAL_MS);
}

main().catch(e => { log(e.message); process.exit(1); });
