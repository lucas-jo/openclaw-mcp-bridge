import WebSocket from "ws";
import crypto from "crypto";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface GatewayClientOptions {
  host: string;
  port: number;
  token: string;
  reconnectInterval?: number;
  requestTimeout?: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function rawPublicKeyFromPem(pem: string): Buffer {
  const spkiDer = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  return spkiDer.subarray(12);
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private nextId = 1;
  private options: Required<GatewayClientOptions>;
  private connected = false;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keypair: { publicKey: string; privateKey: string };
  private deviceId: string;
  private publicKeyBase64Url: string;

  constructor(options: GatewayClientOptions) {
    this.options = {
      reconnectInterval: 5000,
      requestTimeout: 60000,
      ...options,
    };
    this.keypair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const rawPub = rawPublicKeyFromPem(this.keypair.publicKey);
    this.publicKeyBase64Url = base64UrlEncode(rawPub);
    this.deviceId = crypto.createHash("sha256").update(rawPub).digest("hex");
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.options.host}:${this.options.port}`;
      console.error(`[gateway] Connecting to ${url}...`);

      this.ws = new WebSocket(url);
      this.authenticated = false;
      let resolved = false;

      this.ws.on("open", () => {
        console.error("[gateway] WS open, waiting for challenge...");
        this.connected = true;
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        const msg = this.parseMessage(data.toString());
        if (!msg) return;

        if (msg.type === "event" && msg.event === "connect.challenge") {
          const challenge = (msg as Record<string, unknown>).payload as { nonce: string; ts: number };
          this.handleChallenge(challenge)
            .then(() => {
              this.authenticated = true;
              console.error("[gateway] Authenticated as operator");
              if (!resolved) { resolved = true; resolve(); }
            })
            .catch((err: Error) => {
              console.error(`[gateway] Auth failed: ${err.message}`);
              if (!resolved) { resolved = true; reject(err); }
            });
          return;
        }

        if (msg.type === "res" && msg.id !== undefined) {
          const pending = this.pendingRequests.get(String(msg.id));
          if (pending) {
            this.pendingRequests.delete(String(msg.id));
            clearTimeout(pending.timer);
            if (msg.ok === false || msg.error) {
              pending.reject(new Error(`RPC error: ${JSON.stringify(msg.error ?? msg.payload)}`));
            } else {
              pending.resolve(msg.payload);
            }
          }
          return;
        }
      });

      this.ws.on("close", (code, reason) => {
        console.error(`[gateway] Disconnected: ${code} ${reason.toString()}`);
        this.connected = false;
        this.authenticated = false;
        this.rejectAllPending(new Error("WebSocket disconnected"));
        if (resolved) this.scheduleReconnect();
        else { resolved = true; reject(new Error(`WS closed: ${code}`)); }
      });

      this.ws.on("error", (err) => {
        console.error(`[gateway] Error: ${err.message}`);
        if (!resolved) { resolved = true; reject(err); }
      });
    });
  }

  private parseMessage(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw);
    } catch {
      console.error("[gateway] Parse error:", raw.slice(0, 200));
      return null;
    }
  }

  private async handleChallenge(challenge: { nonce: string; ts: number }): Promise<void> {
    const connectId = this.genId();
    const scopes = ["operator.read", "operator.write", "operator.admin"];
    const signedAt = Date.now();

    // payload: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
    const signPayload = [
      "v2",
      this.deviceId,
      "cli",
      "cli",
      "operator",
      scopes.join(","),
      String(signedAt),
      this.options.token,
      challenge.nonce,
    ].join("|");

    const sig = crypto.sign(null, Buffer.from(signPayload, "utf8"), this.keypair.privateKey);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(connectId);
        reject(new Error("Connect handshake timeout"));
      }, 10000);

      this.pendingRequests.set(connectId, {
        resolve: () => resolve(),
        reject,
        timer,
      });

      this.send({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "cli",
            version: "0.1.0",
            platform: process.platform,
            mode: "cli",
          },
          role: "operator",
          scopes,
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: this.options.token },
          locale: "en-US",
          userAgent: "openclaw-mcp-bridge/0.1.0",
          device: {
            id: this.deviceId,
            publicKey: this.publicKeyBase64Url,
            signature: base64UrlEncode(sig),
            signedAt,
            nonce: challenge.nonce,
          },
        },
      });
    });
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new Error("Not connected to Gateway");
    }

    const id = this.genId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (${this.options.requestTimeout}ms)`));
      }, this.options.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.send({
        type: "req",
        id,
        method,
        params: params ?? {},
      });
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private genId(): string {
    return `bridge-${this.nextId++}`;
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        console.error("[gateway] Reconnect failed, will retry...");
        this.scheduleReconnect();
      }
    }, this.options.reconnectInterval);
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.rejectAllPending(new Error("Client disconnected"));
  }
}
