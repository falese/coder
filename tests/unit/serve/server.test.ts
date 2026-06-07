import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRequest, CORS_HEADERS, resolveRequestSystem, buildPromptFromBody } from "../../../src/serve/server.js";
import type { ServeContext } from "../../../src/serve/server.js";
import { createSessionRecorder } from "../../../src/episodes/recorder.js";
import { listEpisodes } from "../../../src/episodes/store.js";

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

// ---------------------------------------------------------------------------
// Prompt capture — the think → capture link for the SSD loop
// ---------------------------------------------------------------------------

describe("handleRequest — prompt capture", () => {
  let packDir: string;

  afterEach(() => {
    if (packDir) rmSync(packDir, { recursive: true, force: true });
  });

  function makePack(): string {
    const dir = mkdtempSync(join(tmpdir(), "coder-serve-cap-"));
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ name: "x", version: "1.2.3" }),
    );
    return dir;
  }

  test("appends the prompt to prompt-log.jsonl when capture is enabled", async () => {
    packDir = makePack();
    const ctx: ServeContext = {
      model: "/models/test",
      dryRun: true,
      capturePrompts: true,
      adaptorPackDir: packDir,
    };
    const res = await postGenerate({ prompt: "refactor the auth guard" }, ctx);
    await readSse(res); // drain so the stream's completion handler runs

    const logFile = join(packDir, "data", "prompt-log.jsonl");
    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { prompt: string; adaptor_version?: string };
    expect(entry.prompt).toBe("refactor the auth guard");
    expect(entry.adaptor_version).toBe("1.2.3");
  });

  test("does not capture when capturePrompts is false", async () => {
    packDir = makePack();
    const ctx: ServeContext = {
      model: "/models/test",
      dryRun: true,
      capturePrompts: false,
      adaptorPackDir: packDir,
    };
    await readSse(await postGenerate({ prompt: "hello" }, ctx));
    expect(existsSync(join(packDir, "data", "prompt-log.jsonl"))).toBe(false);
  });

  test("does not capture when no adaptorPackDir is set", async () => {
    const ctx: ServeContext = { model: "/models/test", dryRun: true, capturePrompts: true };
    const res = await postGenerate({ prompt: "hello" }, ctx);
    expect(res.status).toBe(200); // streams fine; nothing to assert on disk
    await readSse(res);
  });
});

// ---------------------------------------------------------------------------
// Persona trait dial (prompt-layer)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-turn memory
// ---------------------------------------------------------------------------

describe("buildPromptFromBody", () => {
  test("single prompt → raw passthrough", () => {
    const r = buildPromptFromBody({ prompt: "hello" });
    expect(r).toEqual({ prompt: "hello", rawPrompt: false, userContent: "hello" });
  });

  test("messages[] → ChatML, rawPrompt true, userContent = last user", () => {
    const r = buildPromptFromBody({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
    });
    expect(r.rawPrompt).toBe(true);
    expect(r.prompt).toContain("<|im_start|>");
    expect(r.prompt).toContain("second");
    expect(r.userContent).toBe("second");
  });

  test("messages[] + trailing prompt appends a user turn", () => {
    const r = buildPromptFromBody({
      messages: [{ role: "user", content: "prior" }],
      prompt: "latest",
    });
    expect(r.userContent).toBe("latest");
    expect(r.prompt).toContain("latest");
  });

  test("invalid messages fall back to the single-prompt path", () => {
    const r = buildPromptFromBody({ messages: "nope", prompt: "p" });
    expect(r.rawPrompt).toBe(false);
    expect(r.prompt).toBe("p");
  });
});

describe("handleRequest — /generate with messages[]", () => {
  test("dry-run echoes a ChatML-formatted prompt", async () => {
    const res = await postGenerate({
      messages: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "noted" },
        { role: "user", content: "now what" },
      ],
    });
    const body = await readSse(res);
    expect(body).toContain("<|im_start|>");
    expect(body).toContain("now what");
  });

  test("400 when neither prompt nor messages provided", async () => {
    const res = await postGenerate({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Episode recording + /episodes/save
// ---------------------------------------------------------------------------

describe("handleRequest — episode recording", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test("records exchanges by sessionId and saves on /episodes/save", async () => {
    dir = mkdtempSync(join(tmpdir(), "coder-serve-ep-"));
    const recorder = createSessionRecorder({ dir, model: "/models/test" });
    const ctx: ServeContext = { model: "/models/test", dryRun: true, recorder };

    await readSse(await postGenerate({ prompt: "q1", sessionId: "s1" }, ctx));
    await readSse(await postGenerate({ prompt: "q2", sessionId: "s1" }, ctx));
    expect(recorder.has("s1")).toBe(true);

    const save = await handleRequest(
      new Request("http://localhost:3991/episodes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      }),
      ctx,
    );
    expect(save.status).toBe(200);
    const saved = (await save.json()) as { status: string; turns: number };
    expect(saved.status).toBe("saved");
    expect(saved.turns).toBe(4); // 2 user + 2 assistant
    expect(listEpisodes(dir)).toHaveLength(1);
  });

  test("/episodes/save returns 404 for an unknown session", async () => {
    dir = mkdtempSync(join(tmpdir(), "coder-serve-ep2-"));
    const recorder = createSessionRecorder({ dir, model: "/models/test" });
    const ctx: ServeContext = { model: "/models/test", dryRun: true, recorder };
    const res = await handleRequest(
      new Request("http://localhost:3991/episodes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "ghost" }),
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  test("/episodes/save returns 400 when recording is disabled", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3991/episodes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      }),
      dryCtx,
    );
    expect(res.status).toBe(400);
  });
});

describe("resolveRequestSystem", () => {
  test("returns the base system unchanged when no traits given", () => {
    expect(resolveRequestSystem("be helpful", undefined)).toBe("be helpful");
    expect(resolveRequestSystem(undefined, undefined)).toBeUndefined();
  });

  test("folds traits into the system prompt when provided", () => {
    const out = resolveRequestSystem("be helpful", { sarcasm: 7 });
    expect(out).toContain("be helpful");
    expect(out?.toLowerCase()).toContain("sarcas");
  });

  test("applies traits even when no base system prompt is given", () => {
    const out = resolveRequestSystem(undefined, { formality: 7 });
    expect(out).toBeDefined();
    expect(out?.toLowerCase()).toContain("formality");
  });

  test("ignores a non-object traits value", () => {
    expect(resolveRequestSystem("base", "loud")).toBe("base");
  });
});
