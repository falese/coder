import { describe, test, expect } from "bun:test";
import { handleRequest, CORS_HEADERS } from "../../../src/serve/server.js";
import type { ServeContext } from "../../../src/serve/server.js";

const dryCtx: ServeContext = { model: "/models/test", dryRun: true };

function postGenerate(body: unknown, ctx: ServeContext = dryCtx): Promise<Response> {
  return handleRequest(
    new Request("http://localhost:3991/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}

async function readSse(res: Response): Promise<string> {
  return await res.text();
}

describe("handleRequest — /health", () => {
  test("GET /health returns 200 with status ok and model", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/health"),
      dryCtx,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; model: string };
    expect(json.status).toBe("ok");
    expect(json.model).toBe("/models/test");
  });

  test("GET /health includes CORS header", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/health"),
      dryCtx,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("handleRequest — CORS / OPTIONS", () => {
  test("OPTIONS preflight returns 200", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/generate", { method: "OPTIONS" }),
      dryCtx,
    );
    expect(res.status).toBe(200);
  });

  test("OPTIONS preflight carries CORS headers", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/generate", { method: "OPTIONS" }),
      dryCtx,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  test("CORS constant allows any origin", () => {
    expect(CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("handleRequest — /generate", () => {
  test("POST /generate returns text/event-stream content type", async () => {
    const res = await postGenerate({ prompt: "hello world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  test("POST /generate carries CORS header", async () => {
    const res = await postGenerate({ prompt: "hello world" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("POST /generate dry-run emits at least one token event then a done event", async () => {
    const res = await postGenerate({ prompt: "write a sort function" });
    const text = await readSse(res);
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
    expect(text).toContain("[DONE]");
    // token event appears before the done event
    expect(text.indexOf('"type":"token"')).toBeLessThan(text.indexOf('"type":"done"'));
  });

  test("POST /generate done event includes ttft, tokensPerSec, totalTokens", async () => {
    const res = await postGenerate({ prompt: "write a sort function" });
    const text = await readSse(res);
    const doneLine = text
      .split("\n")
      .map((l) => l.replace(/^data: /, ""))
      .find((l) => l.includes('"type":"done"'));
    expect(doneLine).toBeDefined();
    const done = JSON.parse(doneLine as string) as {
      type: string;
      ttft: number;
      tokensPerSec: number;
      totalTokens: number;
    };
    expect(done.type).toBe("done");
    expect(typeof done.ttft).toBe("number");
    expect(typeof done.tokensPerSec).toBe("number");
    expect(done.totalTokens).toBeGreaterThan(0);
  });

  test("missing model returns 400", async () => {
    const res = await postGenerate({ prompt: "hello" }, { model: "", dryRun: true });
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("missing prompt returns 400", async () => {
    const res = await postGenerate({ system: "be brief" });
    expect(res.status).toBe(400);
  });

  test("invalid JSON body returns 400", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not json",
      }),
      dryCtx,
    );
    expect(res.status).toBe(400);
  });
});

describe("handleRequest — unknown routes", () => {
  test("unknown path returns 404 with CORS", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/nope"),
      dryCtx,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
