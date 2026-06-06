import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUN = process.execPath;
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

let tempDir: string;
let configPath: string;
let logsDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-serve-"));
  logsDir = join(tempDir, "logs");
  configPath = join(tempDir, "config.toml");
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(configPath, `logs_dir = "${logsDir}"\nlog_level = "debug"\n`);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Spawn `coder serve --port 0` and resolve the listening port from stderr. */
async function spawnServe(): Promise<{
  port: number;
  proc: ReturnType<typeof Bun.spawn>;
}> {
  const proc = Bun.spawn([BUN, CLI, "serve", "--port", "0", "--model", "/models/test"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CODER_CONFIG_PATH: configPath,
      CODER_DRY_RUN: "1",
    },
  });

  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const match = buffer.match(/listening on http:\/\/localhost:(\d+)/);
    if (match) {
      reader.releaseLock();
      return { port: parseInt(match[1], 10), proc };
    }
  }
  reader.releaseLock();
  proc.kill();
  throw new Error(`serve did not start. stderr:\n${buffer}`);
}

describe("coder serve (integration)", () => {
  test("starts cleanly and /health returns 200", async () => {
    const { port, proc } = await spawnServe();
    try {
      const res = await fetch(`http://localhost:${String(port)}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: string; model: string };
      expect(json.status).toBe("ok");
      expect(json.model).toBe("/models/test");
    } finally {
      proc.kill();
    }
  });

  test("/generate streams SSE tokens end to end", async () => {
    const { port, proc } = await spawnServe();
    try {
      const res = await fetch(`http://localhost:${String(port)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "think about recursion" }),
      });
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const text = await res.text();
      expect(text).toContain('"type":"token"');
      expect(text).toContain('"type":"done"');
      expect(text).toContain("[DONE]");
    } finally {
      proc.kill();
    }
  });

  test("OPTIONS preflight returns 200 with CORS", async () => {
    const { port, proc } = await spawnServe();
    try {
      const res = await fetch(`http://localhost:${String(port)}/generate`, {
        method: "OPTIONS",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    } finally {
      proc.kill();
    }
  });
});
