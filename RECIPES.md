# Connectivity Recipes

This guide provides various ways to connect your remote AI agent to the local OpenClaw MCP Bridge.

> **Important**: Always pass authentication via `headers`, not URL query parameters.
> See [README.md](./README.md#4-configure-your-ai-agent-on-the-remote-machine) for why.

## 1. Tailscale (Recommended)

The most secure and stable way. Tailscale creates an encrypted mesh VPN between your machines.

### Setup:

1. Install [Tailscale](https://tailscale.com) on both local machine and remote server.
2. Get your local machine's Tailscale IP: `tailscale ip -4`

### MCP Config (on the remote machine):

```json
{
  "openclaw-remote": {
    "type": "remote",
    "url": "http://<tailscale-ip>:3100/sse",
    "headers": {
      "x-api-key": "<your-BRIDGE_API_KEY>"
    }
  }
}
```

## 2. SSH Reverse Tunneling

If you have SSH access to your remote server, you can map the local bridge port to the server.

### Setup:

On your **local machine**, run:

```bash
ssh -R 3100:localhost:3100 your-user@your-remote-server
```

### MCP Config (on the remote machine):

Since the tunnel maps to localhost, the remote agent connects locally:

```json
{
  "openclaw-remote": {
    "type": "remote",
    "url": "http://127.0.0.1:3100/sse",
    "headers": {
      "x-api-key": "<your-BRIDGE_API_KEY>"
    }
  }
}
```

## 3. Cloudflare Tunnel (Public URL without opening ports)

Ideal for bypassing firewalls.

### Setup:

1. Install `cloudflared` on your local machine.
2. Run:

```bash
cloudflared tunnel --url http://localhost:3100
```

3. Cloudflare will provide a random URL (e.g., `https://random-words.trycloudflare.com`).

### MCP Config (on the remote machine):

```json
{
  "openclaw-remote": {
    "type": "remote",
    "url": "https://your-tunnel-id.trycloudflare.com/sse",
    "headers": {
      "x-api-key": "<your-BRIDGE_API_KEY>"
    }
  }
}
```

> **Security note**: When using public tunnels (Cloudflare, ngrok, etc.), always set a strong `BRIDGE_API_KEY` and keep it secret.
