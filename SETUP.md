# OpenCode ↔ OpenClaw Bridge

Remote OpenCode (dgx-99) delegates local-only tasks to OpenClaw Gateway running on MacBook via Tailscale mesh VPN.

## Architecture

```
┌─────────────────────────────┐         Tailscale          ┌──────────────────────────────────┐
│  dgx-99 (Remote)            │      100.x ↔ 100.x         │  MacBook (Local)                 │
│                             │                            │                                  │
│  OpenCode                   │                            │  ┌─────────────────────┐         │
│    └─ MCP Client ───────────┼── SSE http :3100/sse ──────┼──┤ openclaw-mcp-bridge │         │
│       (openclaw-bridge)     │                            │  │ (MCP Server)        │         │
│                             │                            │  └────────┬────────────┘         │
│                             │                            │           │ ws://127.0.0.1:18790 │
│                             │                            │  ┌────────▼────────────┐         │
│                             │                            │  │ OpenClaw Gateway    │         │
│                             │                            │  │ (port 18790)        │         │
│                             │                            │  └────────┬────────────┘         │
│                             │                            │           │ WS (loopback)        │
│                             │                            │  ┌────────▼────────────┐         │
│                             │                            │  │ OpenClaw Node Host  │         │
│                             │                            │  │ (macbook-node)      │         │
│                             │                            │  │ caps: browser,system│         │
│                             │                            │  └─────────────────────┘         │
└─────────────────────────────┘                            └──────────────────────────────────┘
```

## Network

| Host | Tailscale IP | Role |
|------|-------------|------|
| dgx-99 | 100.107.38.98 | Remote dev machine (OpenCode) |
| lucass-macbook-pro | 100.106.94.64 | Local machine (OpenClaw Gateway + Node) |

## Components

### 1. OpenClaw Gateway (port 18790, loopback)
Already running on MacBook as a system service. Provides the control plane for all OpenClaw operations.

### 2. openclaw-mcp-bridge (port 3100, 0.0.0.0)
Custom MCP server that translates MCP tool calls into OpenClaw Gateway WebSocket RPC.

- **Location**: `~/openclaw-mcp-bridge/` on MacBook
- **Runs in**: tmux session `openclaw-mcp-bridge`
- **Connects to**: Gateway at `ws://127.0.0.1:18790`
- **Exposes**: SSE MCP endpoint at `http://0.0.0.0:3100/sse`
- **Auth**: Ed25519 device identity + challenge-response signing

### 3. OpenClaw Node Host
Headless node that executes commands on behalf of the Gateway.

- **Runs in**: tmux session `macbook-node`
- **Capabilities**: `browser`, `system`
- **Commands**: `system.run`, `system.which`, `browser.proxy`

## Available MCP Tools

| Tool | Description | Requires Node |
|------|-------------|:------------:|
| `openclaw_gateway_call` | Raw Gateway RPC (health, config, sessions) | No |
| `openclaw_nodes_list` | List connected nodes | No |
| `openclaw_nodes_invoke` | Invoke any node command | Yes |
| `openclaw_system_run` | Execute shell command on MacBook | Yes |
| `openclaw_browser_navigate` | Navigate browser* | Yes |
| `openclaw_browser_screenshot` | Take screenshot* | Yes |
| `openclaw_browser_snapshot` | Accessibility tree* | Yes |
| `openclaw_browser_click` | Click element* | Yes |
| `openclaw_browser_type` | Type text* | Yes |
| `openclaw_browser_evaluate` | Run JavaScript* | Yes |
| `openclaw_browser_tabs` | List browser tabs* | Yes |
| `openclaw_browser_open` | Open new tab* | Yes |

*Browser tools route through `node.invoke` with `browser.proxy`.

## Setup (from scratch)

### Prerequisites
- Tailscale installed and connected on both machines
- OpenClaw installed on MacBook with Gateway running
- SSH access from remote to MacBook via Tailscale
- Bun runtime on MacBook

### Step 1: Deploy bridge to MacBook
```bash
# From remote machine
rsync -avz --exclude node_modules --exclude dist \
  /path/to/openclaw-mcp-bridge/ \
  <macbook-tailscale-ip>:~/openclaw-mcp-bridge/
ssh <macbook-tailscale-ip> "cd ~/openclaw-mcp-bridge && ~/.bun/bin/bun install"
```

### Step 2: Start bridge (MacBook)
```bash
tmux new-session -d -s openclaw-mcp-bridge
tmux send-keys -t openclaw-mcp-bridge \
  'OPENCLAW_GATEWAY_TOKEN=<token> bun run ~/openclaw-mcp-bridge/src/index.ts' Enter
```

### Step 3: Start node host (MacBook)
```bash
tmux new-session -d -s macbook-node
tmux send-keys -t macbook-node \
  'OPENCLAW_GATEWAY_TOKEN=<token> openclaw node run --port <gateway-port> --display-name macbook-node' Enter
```

### Step 4: Configure exec allowlist (MacBook)
```bash
openclaw approvals allowlist add --agent '*' '/bin/bash'
openclaw approvals allowlist add --agent '*' '/usr/bin/*'
openclaw approvals allowlist add --agent '*' '/bin/*'
openclaw approvals allowlist add --agent '*' '/usr/local/bin/*'
```

### Step 5: Add to OpenCode config (Remote)
```json
{
  "mcp": {
    "openclaw-bridge": {
      "type": "remote",
      "url": "http://<macbook-tailscale-ip>:3100/sse"
    }
  }
}
```

### Step 6: Verify
```bash
# From remote
curl http://<macbook-tailscale-ip>:3100/health
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

| Symptom | Fix |
|---------|-----|
| Bridge can't connect to Gateway | Check Gateway port: `openclaw config get gateway.port` |
| "device signature invalid" | Verify signing payload format (v2 pipe-separated) |
| "client/mode must be equal to constant" | Use `mode: "cli"` for operator, `mode: "node"` for node |
| "approval required" on system.run | Add to allowlist: `openclaw approvals allowlist add --agent '*' '/bin/bash'` |
| Node not showing in node list | Ensure `--port` matches Gateway port, token matches |
| SSE connection refused from remote | Check bridge binds to `0.0.0.0`, not `127.0.0.1` |

## File Locations

| File | Host | Path |
|------|------|------|
| Bridge source | MacBook | `~/openclaw-mcp-bridge/src/` |
| Bridge source (dev) | dgx-99 | `/raid/workspaces/lucasjo/new/general_research/openclaw-mcp-bridge/` |
| OpenCode config | dgx-99 | `~/.config/opencode/opencode.json` |
| OpenClaw config | MacBook | `~/.openclaw/openclaw.json` |
| Gateway token | MacBook | `openclaw config get gateway.auth.token` |
| Exec approvals | MacBook | `~/.openclaw/exec-approvals.json` |
| Bridge log | MacBook | `/tmp/openclaw-bridge.log` |
| Node log | MacBook | tmux session `macbook-node` |
