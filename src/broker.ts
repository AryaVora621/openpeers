import http from 'http';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.OPENPEERS_PORT || '7899', 10);
const DASHBOARD_PORT = parseInt(process.env.OPENPEERS_DASHBOARD_PORT || '2468', 10);
const DB_PATH = process.env.OPENPEERS_DB || path.join(os.homedir(), '.openpeers.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    pid INTEGER,
    cwd TEXT,
    tty TEXT,
    summary TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_id TEXT,
    from_id TEXT,
    text TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read BOOLEAN DEFAULT 0
  );
`);

// Cleanup old peers periodically
setInterval(() => {
  db.prepare(`DELETE FROM peers WHERE last_seen < datetime('now', '-1 minute')`).run();
}, 30000);

// --- MAIN BROKER API (7899) ---
const server = http.createServer((req, res) => {
  const sendJson = (data: any, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data: any = {};
      try { data = JSON.parse(body); } catch (e) {}

      try {
        if (req.url === '/register') {
          const id = data.id || crypto.randomBytes(4).toString('hex');
          db.prepare(`INSERT INTO peers (id, pid, cwd, tty, summary) VALUES (?, ?, ?, ?, ?)`).run(
            id, data.pid, data.cwd, data.tty, data.summary || ''
          );
          // Broadcast to dashboard
          broadcastToDashboard({ type: 'peer_joined', peer: { id, cwd: data.cwd, pid: data.pid } });
          return sendJson({ id });
        }

        if (req.url === '/unregister') {
          db.prepare(`DELETE FROM peers WHERE id = ?`).run(data.id);
          broadcastToDashboard({ type: 'peer_left', id: data.id });
          return sendJson({ ok: true });
        }

        if (req.url === '/heartbeat') {
          db.prepare(`UPDATE peers SET last_seen = CURRENT_TIMESTAMP WHERE id = ?`).run(data.id);
          return sendJson({ ok: true });
        }

        if (req.url === '/set-summary') {
          db.prepare(`UPDATE peers SET summary = ? WHERE id = ?`).run(data.summary, data.id);
          broadcastToDashboard({ type: 'peer_updated', peer: { id: data.id, summary: data.summary } });
          return sendJson({ ok: true });
        }

        if (req.url === '/list-peers') {
          let query = `SELECT * FROM peers WHERE last_seen >= datetime('now', '-1 minute')`;
          let params: any[] = [];
          if (data.exclude_id) {
            query += ` AND id != ?`;
            params.push(data.exclude_id);
          }
          const peers = db.prepare(query).all(...params);
          return sendJson(peers);
        }

        if (req.url === '/send-message') {
          db.prepare(`INSERT INTO messages (from_id, to_id, text) VALUES (?, ?, ?)`).run(
            data.from_id || 'dashboard', data.to_id, data.text
          );
          return sendJson({ ok: true });
        }

        if (req.url === '/poll-messages') {
          const messages = db.prepare(`SELECT * FROM messages WHERE to_id = ? AND read = 0 ORDER BY sent_at ASC`).all(data.id);
          if (messages.length > 0) {
            db.prepare(`UPDATE messages SET read = 1 WHERE to_id = ? AND read = 0`).run(data.id);
          }
          return sendJson({ messages });
        }

      } catch (err: any) {
        return sendJson({ error: err.message }, 500);
      }
      
      res.writeHead(404);
      res.end('Not found');
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Broker API listening on port ${PORT}`);
});

// --- DASHBOARD & WEBSOCKET SERVER (2468) ---
const app = express();
app.use(express.static(path.join(__dirname, '../public')));
app.get('/api/peers', (req, res) => {
  const peers = db.prepare(`SELECT * FROM peers WHERE last_seen >= datetime('now', '-1 minute')`).all();
  res.json(peers);
});

const dashboardServer = http.createServer(app);
const wss = new WebSocketServer({ server: dashboardServer });

// Map of peer_id -> WebSocket (the CLI wrappers streaming their stdout)
const cliConnections = new Map<string, WebSocket>();

// Map of Dashboard clients
const dashboardClients = new Set<WebSocket>();

function broadcastToDashboard(msg: any) {
  const data = JSON.stringify(msg);
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const type = url.searchParams.get('type');
  const peerId = url.searchParams.get('peer_id');

  if (type === 'cli' && peerId) {
    // A CLI wrapper has connected to stream its PTY
    cliConnections.set(peerId, ws);

    ws.on('message', (data, isBinary) => {
      // Broadcast this terminal output chunk to all dashboard clients
      broadcastToDashboard({
        type: 'pty_out',
        peer_id: peerId,
        data: isBinary ? data : data.toString()
      });
    });

    ws.on('close', () => {
      cliConnections.delete(peerId);
      broadcastToDashboard({ type: 'peer_left', id: peerId });
    });
  } 
  else if (type === 'dashboard') {
    // A dashboard browser client has connected
    dashboardClients.add(ws);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // If the dashboard wants to send raw keystrokes directly to the CLI PTY
        if (msg.type === 'pty_in' && msg.peer_id && msg.data) {
          const cliWs = cliConnections.get(msg.peer_id);
          if (cliWs && cliWs.readyState === WebSocket.OPEN) {
            cliWs.send(msg.data);
          }
        }
      } catch(e) {}
    });

    ws.on('close', () => {
      dashboardClients.delete(ws);
    });
  }
});

dashboardServer.listen(DASHBOARD_PORT, '127.0.0.1', () => {
  console.log(`Web Dashboard listening on port ${DASHBOARD_PORT}`);
});
