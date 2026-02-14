# Detailed Setup Guide

This document covers the full architecture, manual setup steps, protocol details, and troubleshooting for the OpenClaw MCP Bridge.

## Architecture

```
┌────────────────────────────────┐                              ┌──────────────────────────────────┐
│  Remote Machine                │         Tailscale/VPN        │  Local Machine (e.g. MacBook)    │
│                                │        or SSH Tunnel          │                                  │
│  AI Agent (OpenCode/Cursor)    │                              │  ┌────────────────────────┐      │
│    └─ MCP Client ──────────────┼── SSE http :3100/sse ────────┼──┤ openclaw-bridge-remote │      │
│       (openclaw-remote)        │   (x-api-key header)         │  │ (MCP Server)           │      │
│                                │                              │  └────────┬───────────────┘      │
│                                │                              │           │ ws://127.0.0.1:18790 │
│                                │                              │  ┌────────▼───────────────┐      │
│                                │                              │  │ OpenClaw Gateway       │      │
│                                │                              │  │ (port 18790)           │      │
│                                │                              │  └────────┬───────────────┘      │
│                                │                              │           │ WebSocket            │
│                                │                              │  ┌────────▼───────────────┐      │
│                                │                              │  │ OpenClaw Node Host     │      │
│                                │                              │  │ (e.g. macbook-node)    │      │
│                                │                              │  │ caps: browser, system  │      │
│                                │                              │  └────────────────────────┘      │
└────────────────────────────────┘                              └──────────────────────────────────┘
```

## Components

### 1. OpenClaw Gateway (port 18790, loopback)

Already running on your local machine as a system service. Provides the control plane for all OpenClaw operations.

### 2. openclaw-bridge-remote (port 3100, 0.0.0.0)

Custom MCP server that translates MCP tool calls into OpenClaw Gateway WebSocket RPC.

- **Location**: `~/openclaw-bridge-remote/` on your local machine
- **Connects to**: Gateway at `ws://127.0.0.1:18790`
- **Exposes**: SSE MCP endpoint at `http://0.0.0.0:3100/sse`
- **Auth**: `x-api-key` header (bridge) + Ed25519 challenge-response signing (gateway)

### 3. OpenClaw Node Host

Headless node that executes commands on behalf of the Gateway.

- **Capabilities**: `browser`, `system`
- **Commands**: `system.run`, `system.which`, `browser.proxy`

## Available MCP Tools

| Tool                        | Description                                                     | Requires Node |
| --------------------------- | --------------------------------------------------------------- | :-----------: |
| `openclaw_browser`          | Unified browser control (navigate, click, type, tabs, open, evaluate) |      Yes      |
| `openclaw_browser_screenshot` | Capture browser screenshot (PNG/JPEG)                          |      Yes      |
| `openclaw_browser_snapshot` | Get accessibility tree for AI reasoning (with smart pruning)    |      Yes      |
| `openclaw_system_run`       | Execute shell commands on the local machine                     |      Yes      |
| `openclaw_gateway_call`     | Direct RPC access to OpenClaw Gateway (e.g. `node.list`)        |      No       |

### `openclaw_browser` actions

| Action     | Parameters                  | Description               |
| ---------- | --------------------------- | ------------------------- |
| `navigate` | `url`, `targetId?`          | Navigate to a URL         |
| `click`    | `ref`, `targetId?`          | Click an element          |
| `type`     | `ref`, `text`, `targetId?`  | Type text into an element |
| `tabs`     | `profile?`                  | List open browser tabs    |
| `open`     | `url`, `profile?`           | Open a new tab            |
| `evaluate` | `fn`, `targetId?`           | Run JavaScript in page    |

All browser actions accept an optional `profile` parameter (`chrome` or `openclaw`).

## Manual Setup (Step by Step)

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- [OpenClaw](https://openclaw.ai) installed with Gateway running
- Network connectivity between remote and local machine (Tailscale, SSH tunnel, etc.)

### Step 1: Clone and install

```bash
# On your local machine
git clone https://github.com/lucas-jo/openclaw-bridge-remote.git ~/openclaw-bridge-remote
cd ~/openclaw-bridge-remote
bun install
```

### Step 2: Get your Gateway token

```bash
openclaw config get gateway.auth.token
```

### Step 3: Create `.env` file

```bash
cat <<EOF > ~/openclaw-bridge-remote/.env
OPENCLAW_GATEWAY_TOKEN=<paste-your-token-here>
OPENCLAW_GATEWAY_HOST=127.0.0.1
OPENCLAW_GATEWAY_PORT=18790
BRIDGE_PORT=3100
BRIDGE_API_KEY=$(openssl rand -hex 16)
EOF
```

Save the generated `BRIDGE_API_KEY` — you'll need it for the MCP client config.

### Step 4: Start the bridge

```bash
# Option A: Foreground (for debugging)
cd ~/openclaw-bridge-remote && bun run start

# Option B: Background via tmux
tmux new-session -d -s openclaw-bridge "cd ~/openclaw-bridge-remote && bun run start"
```

You should see:
```
[bridge] Gateway connected: 127.0.0.1:18790
[bridge] MCP SSE server listening on http://0.0.0.0:3100
```

### Step 5: Ensure a Node is running

The bridge needs at least one OpenClaw Node connected for browser/system tools:

```bash
# Check if a node is already running
openclaw node list

# If no node is connected, start one
openclaw node run --display-name macbook-node
```

### Step 6: Configure exec allowlist

For `openclaw_system_run` to work without manual approval:

```bash
openclaw approvals allowlist add --agent '*' '/bin/bash'
openclaw approvals allowlist add --agent '*' '/usr/bin/*'
openclaw approvals allowlist add --agent '*' '/bin/*'
openclaw approvals allowlist add --agent '*' '/usr/local/bin/*'
```

### Step 7: Configure MCP client (on the remote machine)

> **Important**: Always use `headers` with `x-api-key` for authentication.
> Do NOT put the API key in the URL as a query parameter — it will be silently dropped
> by the MCP SDK's SSE transport on POST requests, causing 401 errors.

```json
{
  "mcp": {
    "openclaw-remote": {
      "type": "remote",
      "url": "http://<your-local-ip>:3100/sse",
      "headers": {
        "x-api-key": "<your-BRIDGE_API_KEY>"
      },
      "enabled": true
    }
  }
}
```

_(Tip: Use `tailscale ip -4` on your local machine to get the Tailscale IP)_

### Step 8: Verify

```bash
# From the remote machine
curl -H "x-api-key: <your-BRIDGE_API_KEY>" http://<your-local-ip>:3100/health
# Expected: {"status":"ok","gateway":true,"version":"0.1.0"}
```

## Gateway Protocol Details

### Authentication (Ed25519 challenge-response)

1. Gateway sends `connect.challenge` with `nonce`
2. Client builds signing payload: `v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce` (pipe-separated)
3. Client signs payload with Ed25519 private key
4. Client sends `connect` request with device identity:
   - `publicKey`: raw 32-byte key, base64url encoded
   - `signature`: Ed25519 signature, base64url encoded
   - `deviceId`: `sha256(raw_public_key).hex`

### Node invoke

- `node.invoke` requires `idempotencyKey` (UUID)
- `system.run` expects `command` as argv array + optional `rawCommand` string
- Exec approval allowlist controls which commands are auto-approved

## Troubleshooting

| Symptom                                 | Cause & Fix                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `401 Unauthorized` on MCP connect       | API key not reaching server. Use `headers: {"x-api-key": "..."}`, NOT `?apiKey=` in URL         |
| Bridge can't connect to Gateway         | Check Gateway is running: `openclaw config get gateway.port`                                     |
| "device signature invalid"              | Verify `OPENCLAW_GATEWAY_TOKEN` in `.env` matches `openclaw config get gateway.auth.token`       |
| "approval required" on system.run       | Add to allowlist: `openclaw approvals allowlist add --agent '*' '/bin/bash'`                     |
| Node not showing in node list           | Start a node: `openclaw node run --display-name macbook-node`                                    |
| SSE connection refused from remote      | Check bridge binds to `0.0.0.0` (default), and firewall/network allows port 3100                |
| Browser tools return errors             | Ensure a Node with `browser` capability is connected and Chrome/browser is accessible             |

## File Locations

| File             | Location                                             |
| ---------------- | ---------------------------------------------------- |
| Bridge source    | `~/openclaw-bridge-remote/src/`                      |
| Bridge config    | `~/openclaw-bridge-remote/.env`                      |
| OpenClaw config  | `~/.openclaw/openclaw.json`                          |
| Gateway token    | `openclaw config get gateway.auth.token`             |
| Exec approvals   | `~/.openclaw/exec-approvals.json`                    |
