#!/usr/bin/env node
import * as pty from 'node-pty';
import { spawn } from 'child_process';
import http from 'http';
import os from 'os';
import { WebSocket } from 'ws';
import crypto from 'crypto';

const args = process.argv.slice(2);
const DASHBOARD_PORT = parseInt(process.env.OPENPEERS_DASHBOARD_PORT || '2468', 10);
const BROKER_PORT = process.env.OPENPEERS_PORT || '7899';

if (args[0] === 'run' && args[1] === '--') {
  const cmdArgs = args.slice(2);
  if (cmdArgs.length === 0) {
    console.error("Usage: openpeers run -- <command>");
    process.exit(1);
  }

  const peerId = crypto.randomBytes(4).toString('hex');
  process.env.OPENPEERS_EXPECTED_PEER_ID = peerId;

  // 1. Create IPC Server for MCP Server to inject prompts
  let ptyProcess: pty.IPty;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/inject') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body);
          if (text && ptyProcess) {
            ptyProcess.write(text + '\r');
          }
          res.writeHead(200);
          res.end('OK');
        } catch (e) {
          res.writeHead(400);
          res.end('Bad Request');
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as any).port;
    process.env.OPENPEERS_INJECT_PORT = port.toString();
    
    // 2. Start the CLI Agent in a PTY
    const shell = os.platform() === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || 'sh';
    const commandToRun = cmdArgs.join(' ');

    ptyProcess = pty.spawn(shell, ['-c', commandToRun], {
      name: 'xterm-color',
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: process.env as any
    });

    // 3. Connect to Dashboard WebSocket to stream terminal output
    const ws = new WebSocket(`ws://127.0.0.1:${DASHBOARD_PORT}?type=cli&peer_id=${peerId}`);
    ws.on('error', () => { /* Ignore if dashboard is down */ });
    
    ptyProcess.onData((data) => {
      process.stdout.write(data);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle incoming messages from dashboard
    ws.on('message', (data) => {
      ptyProcess.write(data.toString());
    });

    process.stdin.on('data', (data) => {
      ptyProcess.write(data.toString());
    });
    
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    ptyProcess.onExit(({ exitCode }) => {
      process.exit(exitCode);
    });

    process.stdout.on('resize', () => {
      ptyProcess.resize(process.stdout.columns, process.stdout.rows);
    });
  });

} else if (args[0] === 'status') {
  http.get(`http://127.0.0.1:${BROKER_PORT}/list-peers`, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const peers = JSON.parse(body);
        console.log(`OpenPeers Broker Status: Active`);
        console.log(`Active Peers: ${peers.length}`);
        peers.forEach((p: any) => {
          console.log(`- ID: ${p.id} | PID: ${p.pid} | CWD: ${p.cwd}`);
        });
      } catch(e) {
        console.log("Broker not running or invalid response.");
      }
    });
  }).on('error', () => {
    console.log("Broker is not running.");
  });
} else if (args[0] === 'kill-broker') {
  http.get(`http://127.0.0.1:${BROKER_PORT}/shutdown`, (res) => {
    console.log("Broker shutdown command sent.");
  }).on('error', () => {
    console.log("Broker is not running.");
  });
} else {
  console.log("Usage: openpeers run -- <command>   # Wraps the command and intercepts injections");
  console.log("       openpeers status             # Check active peers");
  console.log("       openpeers kill-broker        # Stop the background broker");
}
