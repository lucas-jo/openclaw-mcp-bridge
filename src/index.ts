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
    name: "openclaw-remote",
    version: "0.1.3",
  });
  registerTools(srv);
  return srv;
}

function registerTools(server: McpServer): void {
  server.tool(
    "openclaw_browser",
    "Unified local browser control (navigate, click, type, tabs, etc.)",
    {
      action: z
        .enum(["navigate", "click", "type", "tabs", "open", "evaluate"])
        .describe("Action to perform"),
      url: z.string().optional().describe("URL for navigate/open"),
      ref: z.string().optional().describe("Element ref for click/type"),
      text: z.string().optional().describe("Text for type"),
      targetId: z.string().optional().describe("Tab ID"),
      profile: z.string().optional().describe("Profile (chrome/openclaw)"),
      fn: z.string().optional().describe("JS code for evaluate"),
    },
    async ({ action, url, ref, text, targetId, profile, fn }) => {
      let result;
      switch (action) {
        case "navigate":
          result = await gateway.call("browser.request", {
            method: "POST",
            path: "/navigate",
            body: { url, targetId },
            query: profile ? { profile } : undefined,
          });
          break;
        case "open":
          result = await gateway.call("browser.request", {
            method: "POST",
            path: "/tabs/open",
            body: { url },
            query: profile ? { profile } : undefined,
          });
          break;
        case "tabs":
          result = await gateway.call("browser.request", {
            method: "GET",
            path: "/tabs",
            query: profile ? { profile } : undefined,
          });
          break;
        default: // click, type, evaluate -> /act
          result = await gateway.call("browser.request", {
            method: "POST",
            path: "/act",
            body: { kind: action === "evaluate" ? "evaluate" : action, ref, text, targetId, fn },
            query: profile ? { profile } : undefined,
          });
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
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
      const result = (await gateway.call("browser.request", {
        method: "POST",
        path: "/screenshot",
        body: { targetId, fullPage, type },
        query: profile ? { profile } : undefined,
      })) as { data?: string };

      if (result && typeof result.data === "string") {
        return {
          content: [
            {
              type: "image" as const,
              data: result.data,
              mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
            },
          ],
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "openclaw_browser_snapshot",
    "Get optimized browser accessibility tree (pruned for AI context)",
    {
      format: z.enum(["aria", "ai"]).optional().describe("Format (aria/ai)"),
      targetId: z.string().optional().describe("Tab ID"),
      profile: z.string().optional().describe("Profile"),
      prune: z.boolean().optional().default(true).describe("Remove non-interactive noise"),
    },
    async ({ format, targetId, profile, prune }) => {
      const result = (await gateway.call("browser.request", {
        method: "GET",
        path: "/snapshot",
        query: { format: format ?? "ai", targetId, profile },
      })) as { text?: string };

      if (prune && result && typeof result.text === "string") {
        // Smart pruning: remove empty/meaningless lines and excessive whitespace
        result.text = result.text
          .split("\n")
          .filter((line: string) => {
            const trimmed = line.trim();
            // Filter out purely decorative or empty elements if needed
            return trimmed.length > 0 && !trimmed.match(/^<[^>]+><\/[^>]+>$/);
          })
          .join("\n")
          .replace(/\s{2,}/g, " "); // Collapse multiple spaces
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "openclaw_system_run",
    "Run shell command on local machine",
    {
      nodeId: z.string().describe("Node ID"),
      command: z.string().describe("Command"),
      cwd: z.string().optional().describe("Working dir"),
      timeoutMs: z.number().optional().describe("Timeout (ms)"),
    },
    async ({ nodeId, command, cwd, timeoutMs }) => {
      const result = await gateway.call("node.invoke", {
        nodeId,
        command: "system.run",
        params: {
          command: ["bash", "-c", command],
          rawCommand: command,
          cwd,
          commandTimeout: timeoutMs,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "openclaw_gateway_call",
    "Direct RPC access to Gateway",
    {
      method: z.string().describe("RPC Method"),
      params: z.record(z.string(), z.unknown()).optional().describe("Params"),
    },
    async ({ method, params }) => {
      const result = await gateway.call(method, params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

const sessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // Auth check if BRIDGE_API_KEY is set
  if (BRIDGE_API_KEY) {
    const apiKey =
      req.headers["x-api-key"] || url.searchParams.get("apiKey") || url.searchParams.get("api-key");
    if (apiKey !== BRIDGE_API_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing BRIDGE_API_KEY" }));
      return;
    }
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        gateway: gateway.isConnected(),
        version: "0.1.0",
      }),
    );
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
  const transportArg = args.find((arg) => arg.startsWith("--transport="))?.split("=")[1] ?? "sse";

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
