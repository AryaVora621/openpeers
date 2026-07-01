# OpenPeers Implementation Plan

OpenPeers is a cross-platform (macOS, Linux, Windows) Model Context Protocol (MCP) server and broker daemon that allows different agentic CLI tools (Google Antigravity, Opencode, OpenAI Codex, Claude Code, etc.) to discover and autonomously prompt each other.

## The Auto-Prompt Problem
The primary challenge with inter-agent communication across different CLI tools is **auto-prompting** (making the receiving agent process the message without the user manually pressing "Enter").

**Proposed Solution (The PTY Wrapper):**
To solve this reliably across Mac, Linux, and Windows, I propose including an optional **PTY Wrapper**. Users will run their agent via `openpeers run -- antigravity`. This wrapper will intercept the terminal session and expose a local IPC port. When the MCP server receives a message, it tells the wrapper to inject the text and simulate an "Enter" keystroke natively into the agent's stdin.

For users who don't use the wrapper, we will include OS-specific fallbacks (e.g., AppleScript on macOS) or CLI-specific features (e.g., `notifications/claude/channel` for Claude Code).

## Proposed Architecture

OpenPeers consists of three main components:

1. **Broker Daemon** (`src/broker.ts`)
   - A central local server (e.g., `localhost:7899`) backed by a lightweight SQLite database.
   - Coordinates active peers, handles registration, and routes messages.

2. **MCP Server** (`src/server.ts`)
   - Spawned as a standard stdio MCP server by the agent CLI.
   - Connects to the Broker to register itself and poll/listen for messages.
   - Exposes tools to the LLM: `list_peers`, `send_message`, `set_summary`.
   - Handles the injection of incoming messages into the agent's prompt queue.

3. **CLI & PTY Wrapper** (`src/cli.ts`)
   - **Command:** `openpeers run -- <agent-cli-command>`
   - Spawns the agent inside a pseudo-terminal (`node-pty`).
   - Starts an internal HTTP/IPC server and sets `OPENPEERS_INJECT_PORT`.
   - When the MCP server receives a message from the broker, it posts to this port, and the wrapper seamlessly injects the text + `\n` into the terminal.

## Proposed Changes

### Core Project Structure

#### [NEW] package.json
- Setup a Bun or Node/TypeScript project.
- Add dependencies: `@modelcontextprotocol/sdk`, `node-pty` (for cross-platform terminal wrapping), `sqlite3` (or `better-sqlite3`/bun sqlite) for the broker database.

#### [NEW] src/shared/types.ts
- Interfaces for Peer, RegisterResponse, Message, etc.

#### [NEW] src/broker.ts
- The daemon logic that maintains peer state.
- Handles `/register`, `/unregister`, `/list-peers`, `/send-message`.

#### [NEW] src/server.ts
- The stdio MCP Server.
- Provides tools for LLM interaction.
- Auto-prompting logic: checks for `OPENPEERS_INJECT_PORT`, falls back to macOS AppleScript/Claude channels if missing.

#### [NEW] src/cli.ts
- `openpeers status`: View broker status and all active peers.
- `openpeers run -- <command>`: The PTY wrapper that makes auto-prompting universal.

#### [NEW] src/injector.ts
- Fallback OS-level automation for injecting keystrokes if the PTY wrapper isn't used.
- Prioritizes macOS (using `osascript` to target Terminal/iTerm).
