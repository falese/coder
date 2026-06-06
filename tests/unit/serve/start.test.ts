import { describe, test, expect } from "bun:test";
import { startServer } from "../../../src/serve/start.js";
import type { ServeContext } from "../../../src/serve/server.js";

const ctx: ServeContext = { model: "/models/test", dryRun: true };

describe("startServer", () => {
  test("boots on an ephemeral port and serves /health", async () => {
    const server = startServer(ctx, 0);
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://localhost:${String(server.port)}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: string };
      expect(json.status).toBe("ok");
    } finally {
      server.stop();
    }
  });

  test("streams SSE tokens from /generate in dry-run", async () => {
    const server = startServer(ctx, 0);
    try {
      const res = await fetch(`http://localhost:${String(server.port)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello there" }),
      });
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      const text = await res.text();
      expect(text).toContain('"type":"token"');
      expect(text).toContain('"type":"done"');
      expect(text).toContain("[DONE]");
    } finally {
      server.stop();
    }
  });
});
