#!/usr/bin/env bun
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "http";
import crypto from "crypto";
import { GatewayClient } from "./gateway-client.js";
import { z } from "zod";

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? "18790", 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? "3100", 10);
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY ?? "";

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
  "Call OpenClaw Gateway RPC",
  {
    method: z.string().describe("Method (health, config.get, etc)"),
    params: z.record(z.string(), z.unknown()).optional().describe("Params"),
  },
  async ({ method, params }) => {
    const result = await gateway.call(method, params);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_nodes_list",
  "List OpenClaw nodes",
  {},
  async () => {
    const result = await gateway.call("node.list");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "openclaw_nodes_invoke",
  "Invoke node command",
  {
    nodeId: z.string().describe("Node ID or name"),
    command: z.string().describe("Command (canvas.navigate, etc)"),
    params: z.record(z.string(), z.unknown()).optional().describe("Params"),
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
  "Navigate local browser",
  {
    url: z.string().describe("URL"),
    targetId: z.string().optional().describe("Tab ID"),
    profile: z.string().optional().describe("Profile (chrome/openclaw)"),
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
  "Take browser screenshot",
  {
    targetId: z.string().optional().describe("Tab ID"),
    fullPage: z.boolean().optional().describe("Full page"),
    type: z.enum(["png", "jpeg"]).optional().describe("Format"),
    profile: z.string().optional().describe("Profile"),
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
  "Get browser accessibility tree",
  {
    format: z.enum(["aria", "ai"]).optional().describe("Format (aria/ai)"),
    targetId: z.string().optional().describe("Tab ID"),
    profile: z.string().optional().describe("Profile"),
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
  "Click element",
  {
    ref: z.string().describe("Element ref"),
    targetId: z.string().optional().describe("Tab ID"),
    profile: z.string().optional().describe("Profile"),
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
  "Type text into element",
  {
    ref: z.string().describe("Element ref"),
    text: z.string().describe("Text"),
    submit: z.boolean().optional().describe("Press Enter"),
    targetId: z.string().optional().describe("Tab ID"),
    profile: z.string().optional().describe("Profile"),
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
  "Run JS in browser",
  {
    fn: z.string().describe("JS code"),
    targetId: z.string().optional().describe("Tab ID"),
    profile: z.string().optional().describe("Profile"),
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
  "List browser tabs",
  {
    profile: z.string().optional().describe("Profile"),
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
  "Open URL in new tab",
  {
    url: z.string().describe("URL"),
    profile: z.string().optional().describe("Profile"),
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
  "Run shell command",
  {
    nodeId: z.string().describe("Node ID"),
    command: z.string().describe("Command"),
    cwd: z.string().optional().describe("Working dir"),
    env: z.record(z.string(), z.string()).optional().describe("Env vars"),
    timeoutMs: z.number().optional().describe("Timeout (ms)"),
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

  // Auth check if BRIDGE_API_KEY is set
  if (BRIDGE_API_KEY) {
    const apiKey = req.headers["x-api-key"] || url.searchParams.get("apiKey");
    if (apiKey !== BRIDGE_API_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing BRIDGE_API_KEY" }));
      return;
    }
  }

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

async function runStdioServer() {
  const server = createBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[bridge] MCP stdio server running");
}

async function runSseServer() {
  httpServer.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.error(`[bridge] MCP SSE server listening on http://0.0.0.0:${BRIDGE_PORT}`);
    console.error(`[bridge] SSE endpoint: http://0.0.0.0:${BRIDGE_PORT}/sse`);
    console.error(`[bridge] Health: http://0.0.0.0:${BRIDGE_PORT}/health`);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transportArg = args.find(arg => arg.startsWith("--transport="))?.split("=")[1] ?? "sse";

  await gateway.connect();
  console.error(`[bridge] Gateway connected: ${GATEWAY_HOST}:${GATEWAY_PORT}`);

  if (transportArg === "stdio") {
    await runStdioServer();
  } else {
    await runSseServer();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
