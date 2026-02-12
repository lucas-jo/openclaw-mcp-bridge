# Connectivity Recipes 🌐

This guide provides various ways to connect your remote AI agent to the local OpenClaw MCP Bridge when a direct VPN (like Tailscale) is not available.

## 1. SSH Reverse Tunneling (The Pro Way)

If you have SSH access to your remote server, you can map the local bridge port to the server.

### Setup:
On your **local machine** (MacBook), run:
```bash
ssh -R 3100:localhost:3100 your-user@your-remote-server
```

### Usage in Agent:
Now the remote agent can access the bridge as if it were local to the server:
```json
{
  "url": "http://127.0.0.1:3100/sse?apiKey=YOUR_KEY"
}
```

## 2. Cloudflare Tunnel (Secure Public URL)

Ideal for bypassing firewalls without opening ports.

### Setup:
1. Install `cloudflared` on your local machine.
2. Run:
```bash
cloudflared tunnel --url http://localhost:3100
```
3. Cloudflare will provide a random URL (e.g., `https://random-words.trycloudflare.com`).

### Usage in Agent:
Use the Cloudflare URL with your API key:
```json
{
  "url": "https://your-tunnel-id.trycloudflare.com/sse?apiKey=YOUR_KEY"
}
```

## 3. Tailscale (Recommended)

The most secure and stable way.

1. Install Tailscale on both MacBook and Remote Server.
2. Get MacBook IP: `tailscale ip -4`.
3. Use `http://<tailscale-ip>:3100/sse?apiKey=YOUR_KEY`.

---
*Note: Always keep your `BRIDGE_API_KEY` secret when using public tunnels.*
