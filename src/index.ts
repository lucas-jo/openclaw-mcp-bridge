import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "http";
import crypto from "crypto";
import { GatewayClient } from "./gateway-client.js";
import { z } from "zod";

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? "18790", 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? "3100", 10);

if (!GATEWAY_TOKEN) {
  console.error("OPENCLAW_GATEWAY_TOKEN is required");
  process.exit(1);
}

const gateway = new GatewayClient({
  host: GATEWAY_HOST,
  port: GATEWAY_PORT,
  token: GATEWAY_TOKEN,
  requestTimeout: 60000,
});

function createBridgeServer(): McpServer {
  const srv = new McpServer({
    name: "openclaw-bridge",
    version: "0.1.0",
  });
  registerTools(srv);
  return srv;
}

function registerTools(server: McpServer): void {

server.tool(
  "openclaw_gateway_call",
  "Call any OpenClaw Gateway RPC method directly. Use for: health checks, config, sessions, etc.",
  {
    method: z.string().describe("RPC method name (e.g. 'health', 'config.get', 'sessions.list')"),
    params: z.record(z.string(), z.unknown()).optional().describe("RPC parameters as JSON object"),
  },
  async ({ method, params }) => {
    const result = await gateway.call(method, params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_nodes_list",
  "List all connected OpenClaw nodes and their capabilities",
  {},
  async () => {
    const result = await gateway.call("node.list");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_nodes_invoke",
  "Invoke a command on an OpenClaw node (canvas, camera, system, screen, etc.)",
  {
    nodeId: z.string().describe("Node ID, name, or IP"),
    command: z.string().describe("Command to invoke (e.g. 'canvas.navigate', 'canvas.snapshot', 'system.run', 'camera.snap')"),
    params: z.record(z.string(), z.unknown()).optional().describe("Command parameters"),
  },
  async ({ nodeId, command, params }) => {
    const result = await gateway.call("node.invoke", {
      nodeId,
      command,
      params: params ?? {},
      idempotencyKey: crypto.randomUUID(),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_navigate",
  "Navigate the local browser to a URL",
  {
    url: z.string().describe("URL to navigate to"),
    targetId: z.string().optional().describe("Browser tab target ID"),
    profile: z.string().optional().describe("Browser profile ('chrome' for relay, 'openclaw' for isolated)"),
  },
  async ({ url, targetId, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/navigate",
      body: { url, targetId },
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_screenshot",
  "Take a screenshot of the local browser",
  {
    targetId: z.string().optional().describe("Browser tab target ID"),
    fullPage: z.boolean().optional().describe("Capture full page"),
    type: z.enum(["png", "jpeg"]).optional().describe("Image format"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ targetId, fullPage, type, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/screenshot",
      body: { targetId, fullPage, type },
      query: profile ? { profile } : undefined,
    }) as any;

    if (result && typeof result.data === "string") {
      return {
        content: [{
          type: "image" as const,
          data: result.data,
          mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
        }],
      };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_snapshot",
  "Get accessibility tree snapshot of the local browser page (for AI interaction)",
  {
    format: z.enum(["aria", "ai"]).optional().describe("Snapshot format: 'aria' or 'ai'"),
    targetId: z.string().optional().describe("Browser tab target ID"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ format, targetId, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "GET",
      path: "/snapshot",
      query: {
        format: format ?? "ai",
        targetId,
        profile,
      },
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_click",
  "Click an element in the local browser (by accessibility ref)",
  {
    ref: z.string().describe("Element reference from snapshot"),
    targetId: z.string().optional().describe("Browser tab target ID"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ ref, targetId, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/act",
      body: { kind: "click", ref, targetId },
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_type",
  "Type text into an element in the local browser",
  {
    ref: z.string().describe("Element reference from snapshot"),
    text: z.string().describe("Text to type"),
    submit: z.boolean().optional().describe("Press Enter after typing"),
    targetId: z.string().optional().describe("Browser tab target ID"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ ref, text, submit, targetId, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/act",
      body: { kind: "type", ref, text, submit, targetId },
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_evaluate",
  "Execute JavaScript in the local browser",
  {
    fn: z.string().describe("JavaScript code to evaluate"),
    targetId: z.string().optional().describe("Browser tab target ID"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ fn, targetId, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/act",
      body: { kind: "evaluate", fn, targetId },
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_tabs",
  "List open browser tabs",
  {
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ profile }) => {
    const result = await gateway.call("browser.request", {
      method: "GET",
      path: "/tabs",
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_browser_open",
  "Open a URL in a new browser tab",
  {
    url: z.string().describe("URL to open"),
    profile: z.string().optional().describe("Browser profile"),
  },
  async ({ url, profile }) => {
    const result = await gateway.call("browser.request", {
      method: "POST",
      path: "/tabs/open",
      body: { url },
      query: profile ? { profile } : undefined,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_system_run",
  "Execute a shell command on the local machine via OpenClaw node",
  {
    nodeId: z.string().describe("Node ID, name, or IP"),
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
    timeoutMs: z.number().optional().describe("Command timeout in milliseconds"),
  },
  async ({ nodeId, command, cwd, env, timeoutMs }) => {
    const params: Record<string, unknown> = {
      command: ["bash", "-c", command],
      rawCommand: command,
    };
    if (cwd) params.cwd = cwd;
    if (env) params.env = env;
    if (timeoutMs) params.commandTimeout = timeoutMs;
    const result = await gateway.call("node.invoke", {
      nodeId,
      command: "system.run",
      params,
      idempotencyKey: crypto.randomUUID(),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

}

const sessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      gateway: gateway.isConnected(),
      version: "0.1.0",
    }));
    return;
  }

  if (url.pathname === "/sse") {
    const transport = new SSEServerTransport("/messages", res);
    const mcpServer = createBridgeServer();
    sessions.set(transport.sessionId, { transport, server: mcpServer });
    res.on("close", () => {
      sessions.delete(transport.sessionId);
      mcpServer.close().catch(() => {});
    });
    await mcpServer.connect(transport);
    return;
  }

  if (url.pathname === "/messages" && req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid sessionId" }));
      return;
    }
    const { transport } = sessions.get(sessionId)!;
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

async function main(): Promise<void> {
  await gateway.connect();
  console.error(`[bridge] Gateway connected: ${GATEWAY_HOST}:${GATEWAY_PORT}`);

  httpServer.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.error(`[bridge] MCP server listening on http://0.0.0.0:${BRIDGE_PORT}`);
    console.error(`[bridge] SSE endpoint: http://0.0.0.0:${BRIDGE_PORT}/sse`);
    console.error(`[bridge] Health: http://0.0.0.0:${BRIDGE_PORT}/health`);
    console.error("");
    console.error("Add to remote OpenCode config:");
    console.error(JSON.stringify({
      "openclaw-bridge": {
        type: "remote",
        url: `http://<tailscale-ip>:${BRIDGE_PORT}/sse`,
      },
    }, null, 2));
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
