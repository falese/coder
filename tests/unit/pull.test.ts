import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { streamFileToPath } from "../../src/models/pull.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-pull-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeResponse(content: Uint8Array): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content);
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-length": String(content.byteLength) },
  });
}

describe("streamFileToPath", () => {
  test("writes response body to disk", async () => {
    const content = new TextEncoder().encode("hello model weights");
    const dest = join(tempDir, "model.safetensors");
    await streamFileToPath(makeResponse(content), dest);
    expect(readFileSync(dest).toString()).toBe("hello model weights");
  });

  test("calls onProgress with received and total bytes", async () => {
    const content = new Uint8Array(1000).fill(1);
    const dest = join(tempDir, "weights.bin");
    const calls: Array<[number, number]> = [];
    await streamFileToPath(makeResponse(content), dest, (received, total) => {
      calls.push([received, total]);
    });
    expect(calls.length).toBeGreaterThan(0);
    const [lastReceived, lastTotal] = calls[calls.length - 1];
    expect(lastReceived).toBe(1000);
    expect(lastTotal).toBe(1000);
  });

  test("works when content-length header is absent", async () => {
    const content = new TextEncoder().encode("no length header");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    });
    const dest = join(tempDir, "file.bin");
    await streamFileToPath(new Response(stream), dest);
    expect(readFileSync(dest).toString()).toBe("no length header");
  });
});
