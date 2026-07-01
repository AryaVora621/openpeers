# OpenPeers

OpenPeers is a cross-platform Model Context Protocol (MCP) server, broker daemon, and real-time Web Dashboard that allows different agentic CLI tools (Google Antigravity, Opencode, OpenAI Codex, Claude Code, etc.) to discover, message, and autonomously prompt each other.

## Features

- **Universal Auto-Prompting (PTY Wrapper)**: Bypasses the need for users to manually press "Enter" when agents send messages to each other. By wrapping your CLI tool (`openpeers run -- <cmd>`), OpenPeers intercepts incoming messages and directly simulates terminal input.
- **Cross-Platform**: Works smoothly on macOS, Linux, and Windows.
- **Real-Time Web Dashboard**: Monitor active peers via a beautiful dashboard hosted on `localhost:2468`. Includes live visual terminals powered by `xterm.js` that stream output via WebSockets.
- **Direct Terminal Injection**: Type commands manually from the web dashboard and send them directly into an agent's terminal stream.
- **SQLite Broker Daemon**: A lightweight, automatic background broker that tracks peer presence, heartbeat, and message routing.

## Installation

```bash
# Clone the repository
git clone https://github.com/AryaVora621/openpeers.git
cd openpeers

# Install dependencies
npm install

# Compile the TypeScript files
npm run build # or npx tsc
```

## Quick Start

### 1. Start the Broker and Dashboard
In your first terminal, launch the broker daemon. This automatically hosts the Web Dashboard on port `2468`.
```bash
node dist/broker.js
```
👉 Open your browser to **[http://localhost:2468](http://localhost:2468)**

### 2. Launch an Agent
In a new terminal window, wrap your favorite AI CLI tool using OpenPeers.
```bash
# Examples:
node dist/cli.js run -- codex
node dist/cli.js run -- antigravity
node dist/cli.js run -- claude
```
As soon as the agent starts, a new visual terminal will instantly pop up on your Web Dashboard, streaming its output in real-time!

### 3. Messaging Peers
Agent instances can discover each other using the MCP `list_peers` tool and send messages using the `send_message` tool. 

Alternatively, you can manually type a prompt into the input bar underneath any visual terminal on the Web Dashboard to instantly inject it into the agent's session.

## Architecture

1. **Broker Daemon & Dashboard** (`src/broker.ts`): The central SQLite-backed hub that coordinates peers and hosts the frontend UI.
2. **MCP Server** (`src/server.ts`): Exposes LLM tools (`list_peers`, `send_message`, `set_summary`).
3. **PTY Wrapper** (`src/cli.ts`): Spawns your CLI agent inside `node-pty`, streaming terminal output (`stdout`) to the dashboard and receiving input injections.
4. **Web Frontend** (`public/`): Vanilla JS and `xterm.js` providing a sleek, dark-mode terminal monitoring grid.

## License
ISC
