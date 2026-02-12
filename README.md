# OpenClaw MCP Bridge

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)

A high-performance bridge that exposes [OpenClaw](https://openclaw.ai) capabilities as a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server. 

This bridge allows remote AI agents (like OpenCode, Cursor, or Windsurf running on remote servers) to securely delegate local tasks—such as browser automation and shell execution—to an OpenClaw Gateway running on your local machine (e.g., MacBook) via Tailscale or any network connection.

## 🚀 Why this exists?

When working on powerful remote servers (GPU clusters, resourceful cloud instances, etc.), AI agents are "blind" to your local environment. This bridge provides the "eyes and hands" by connecting the remote agent to your local OpenClaw instance.

- **Local Browser Control**: Navigate, screenshot, click, and scrape pages on your local machine.
- **Local Shell Access**: Execute commands on your local OS (say, open, pbcopy, hardware control).
- **Secure Authentication**: Implements OpenClaw's Ed25519 challenge-response signing protocol.
- **Hybrid Routing**: Intelligently routes commands between the OpenClaw Gateway and connected Nodes.

## 🏗 Architecture

```mermaid
graph LR
    subgraph Remote_Server
        A[AI Agent / OpenCode] -- "SSE (MCP)" --> B[openclaw-mcp-bridge]
    end
    
    subgraph Local_Machine
        B -- "Tailscale/Network" --> C[OpenClaw Gateway]
        C -- "WebSocket" --> D[Local Browser]
        C -- "WebSocket" --> E[OpenClaw Node]
        E -- "Exec" --> F[Local OS Shell]
    end
```

## ⚡ Quick Start (One-liner Install)

Run this on your local machine (e.g. MacBook) to install and configure everything automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/lucas-jo/openclaw-mcp-bridge/main/install.sh | bash
```

## ⚙️ Configuration

The installer creates a `.env` file in the project directory. You can manually adjust these values:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCLAW_GATEWAY_TOKEN` | Your OpenClaw Gateway auth token | **Required** |
| `BRIDGE_API_KEY` | Secret key for the bridge itself | (Auto-generated) |
| `OPENCLAW_GATEWAY_HOST` | Local OpenClaw Gateway host | `127.0.0.1` |
| `OPENCLAW_GATEWAY_PORT` | Local OpenClaw Gateway port | `18790` |
| `BRIDGE_PORT` | Port for the MCP SSE server | `3100` |

## 🏃 Running the Bridge

### Option 1: SSE Mode (Server)
Ideal for remote agents connecting via network (e.g., remote resourceful server to MacBook).
```bash
bun run start --transport=sse
```

### Option 2: Stdio Mode (CLI) - Recommended for Local
Ideal for local agents like Cursor or Windsurf. Lower latency and token-efficient.
```bash
bun run start --transport=stdio
```

## 🤖 Adding to your Agent

### Remote Agent (SSE)
Add to your `mcpServers` config:
```json
{
  "openclaw-bridge": {
    "type": "remote",
    "url": "http://<your-local-ip>:3100/sse?apiKey=YOUR_BRIDGE_API_KEY"
  }
}
```
*(Tip: Use `tailscale ip -4` to get your secure IP)*

## 🛠 Available MCP Tools

| Tool | Description |
|------|-------------|
| `openclaw_browser_navigate` | Navigate local browser to a URL |
| `openclaw_browser_snapshot` | Get accessibility tree for AI reasoning |
| `openclaw_browser_screenshot` | Capture local browser screen |
| `openclaw_system_run` | Execute shell commands on the local machine |
| `openclaw_nodes_list` | List connected OpenClaw nodes |
| `openclaw_gateway_call` | Direct RPC access to OpenClaw Gateway |

## 📖 Documentation

- **[RECIPES.md](./RECIPES.md)**: Connectivity options (SSH Tunneling, Cloudflare Tunnel, etc.).
- **[SETUP.md](./SETUP.md)**: Detailed architecture, protocol details, and manual troubleshooting.

## 📜 License

MIT © [Lucas Jo](https://github.com/lucas-jo)
