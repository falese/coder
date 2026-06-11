import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runMlxStream } from "../inference/mlx-runner.js";
import { stripFraming, parseChannels } from "./clean.js";
import { capturePrompt } from "../adaptors/prompt-log.js";
import { applyTraits, resolveTraits } from "../persona/traits.js";
import { formatPrompt, applyWindow } from "../chat/history.js";
import type { Turn } from "../chat/history.js";
import { parseThreads } from "../episodes/threads.js";
import type { SessionRecorder } from "../episodes/recorder.js";

/**
 * Local SSE inference server context.
 *
 * Holds the already-resolved model / adaptor so request handling stays pure:
 * the handler never touches config — capture is driven entirely by these
 * injected fields, which keeps the handler trivially unit-testable with a
 * constructed `Request` and a temp `adaptorPackDir`.
 */
export interface ServeContext {
  model: string;
  adaptorPath?: string;
  dryRun: boolean;
  /** When true (and adaptorPackDir set), append each prompt to the SSD log. */
  capturePrompts?: boolean;
  /** Adaptor pack root (…/adaptors/<name>) — capture target + manifest source. */
  adaptorPackDir?: string;
  /** When set, completed exchanges are recorded into episodes by sessionId. */
  recorder?: SessionRecorder;
}

interface GenerateBody {
  prompt?: unknown;
  system?: unknown;
  maxTokens?: unknown;
  /** Optional persona trait dial, e.g. { sarcasm: 3 }. Merged into the system prompt. */
  traits?: unknown;
  /** Prior conversation turns for cross-turn memory (ChatML-formatted server-side). */
  messages?: unknown;
  /** Groups exchanges into one episode. */
  sessionId?: unknown;
}

interface NormalizedRequest {
  /** Final prompt string handed to mlx_lm. */
  prompt: string;
  /** True when the prompt is pre-formatted ChatML (pass --ignore-chat-template). */
  rawPrompt: boolean;
  /** The latest user input, recorded as the user turn of an episode. */
  userContent: string;
}

function isTurnArray(v: unknown): v is Turn[] {
  return (
    Array.isArray(v) &&
    v.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        (t as { role?: unknown }).role !== undefined &&
        ((t as { role: unknown }).role === "user" || (t as { role: unknown }).role === "assistant") &&
        typeof (t as { content?: unknown }).content === "string",
    )
  );
}

/**
 * Build the effective prompt for a request. With `messages`, prior turns are
 * windowed + ChatML-formatted server-side (reusing the `coder chat` path) so an
 * episode is a coherent multi-turn session; an optional `prompt` is appended as
 * the trailing user turn. Without `messages`, the single `prompt` is used as-is
 * (mlx_lm applies its own chat template). Exported pure for testing.
 */
export function buildPromptFromBody(body: { prompt?: unknown; messages?: unknown }): NormalizedRequest {
  const trailing = typeof body.prompt === "string" ? body.prompt : "";
  if (isTurnArray(body.messages) && body.messages.length > 0) {
    const turns: Turn[] = [...body.messages];
    if (trailing.length > 0) turns.push({ role: "user", content: trailing });
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    return {
      prompt: formatPrompt(applyWindow(turns)),
      rawPrompt: true,
      userContent: lastUser?.content ?? trailing,
    };
  }
  return { prompt: trailing, rawPrompt: false, userContent: trailing };
}

/**
 * Resolve the effective system prompt for a request. The prompt-layer persona
 * dial: when `traits` is an object, its values are folded into the system
 * prompt (immediate, no retrain). Absent/invalid traits leave the base system
 * prompt untouched. Exported pure so the trait wiring is testable without
 * streaming (dry-run only echoes the prompt, never the system).
 */
export function resolveRequestSystem(system: unknown, traits: unknown): string | undefined {
  const baseSystem = typeof system === "string" ? system : undefined;
  if (typeof traits === "object" && traits !== null) {
    return applyTraits(baseSystem ?? "", resolveTraits(traits as Record<string, unknown>));
  }
  return baseSystem;
}

/** Append the prompt to the adaptor's SSD prompt-log when capture is enabled. */
function maybeCapture(prompt: string, ctx: ServeContext): void {
  if (ctx.capturePrompts !== true || ctx.adaptorPackDir === undefined) return;
  let version: string | undefined;
  const manifestPath = join(ctx.adaptorPackDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      if (typeof m.version === "string") version = m.version;
    } catch { /* ignore — version is best-effort */ }
  }
  capturePrompt(prompt, ctx.adaptorPackDir, version);
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

interface GenerateParams {
  prompt: string;
  system: string | undefined;
  maxTokens: number;
  rawPrompt: boolean;
  sessionId?: string;
  /** The latest user input, for episode recording (may differ from `prompt`). */
  userContent: string;
}

function buildGenerateResponse(params: GenerateParams, ctx: ServeContext): Response {
  const { prompt, system, maxTokens, rawPrompt, sessionId, userContent } = params;
  const { stream: tokenStream, result } = runMlxStream({
    model: ctx.model,
    prompt,
    maxTokens,
    dryRun: ctx.dryRun,
    adaptor: ctx.adaptorPath,
    systemFile: system,
    rawPrompt,
  });

  const encoder = new TextEncoder();

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => {
        controller.enqueue(encoder.encode(sseEvent(obj)));
      };
      let totalTokens = 0;
      // Strip mlx_lm framing, then split into thought/final channels so reasoning
      // models stream both voices (tagged per token). Hold back the tail so a
      // partial marker (e.g. "<|chann", "==========") is never emitted mid-stream;
      // the remainder is flushed once the stream ends.
      const HOLDBACK = 16;
      let raw = "";
      let emittedThought = "";
      let emittedFinal = "";

      const flush = (
        channel: "thought" | "final",
        buf: string,
        emitted: string,
        withHoldback: boolean,
      ): string => {
        const target = withHoldback ? Math.max(0, buf.length - HOLDBACK) : buf.length;
        if (target > emitted.length) {
          send({ type: "token", channel, text: buf.slice(emitted.length, target) });
          totalTokens += 1;
          return buf.slice(0, target);
        }
        return emitted;
      };

      try {
        const reader = tokenStream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += value;
          const { thought, final } = parseChannels(stripFraming(raw));
          emittedThought = flush("thought", thought, emittedThought, true);
          emittedFinal = flush("final", final, emittedFinal, true);
        }
        const { thought, final } = parseChannels(stripFraming(raw));
        emittedThought = flush("thought", thought, emittedThought, false);
        emittedFinal = flush("final", final, emittedFinal, false);
        const r = await result;
        send({
          type: "done",
          ttft: r.ttftMs ?? 0,
          tokensPerSec: r.tokensPerSecond ?? 0,
          totalTokens,
        });
        // The user input is real regardless of dry-run, so capture it once the
        // generation completes successfully.
        maybeCapture(userContent, ctx);
        if (ctx.recorder !== undefined && sessionId !== undefined) {
          ctx.recorder.record(sessionId, {
            userContent,
            final,
            ...(thought.length > 0 ? { thought } : {}),
            threads: parseThreads(final),
          });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
}

async function handleGenerate(req: Request, ctx: ServeContext): Promise<Response> {
  if (!ctx.model) {
    return json({ type: "error", message: "No model configured. Start with --model <path> or set default_model." }, 400);
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return json({ type: "error", message: "Invalid JSON body" }, 400);
  }

  const hasPrompt = typeof body.prompt === "string" && body.prompt.length > 0;
  const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
  if (!hasPrompt && !hasMessages) {
    return json({ type: "error", message: "Field 'prompt' or 'messages' is required" }, 400);
  }

  const maxTokens = typeof body.maxTokens === "number" ? body.maxTokens : 512;
  const system = resolveRequestSystem(body.system, body.traits);
  const { prompt, rawPrompt, userContent } = buildPromptFromBody(body);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

  return buildGenerateResponse(
    { prompt, system, maxTokens, rawPrompt, sessionId, userContent },
    ctx,
  );
}

async function handleEpisodeSave(req: Request, ctx: ServeContext): Promise<Response> {
  if (!ctx.recorder) {
    return json({ type: "error", message: "Episode recording is not enabled" }, 400);
  }
  let body: { sessionId?: unknown };
  try {
    body = (await req.json()) as { sessionId?: unknown };
  } catch {
    return json({ type: "error", message: "Invalid JSON body" }, 400);
  }
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return json({ type: "error", message: "Field 'sessionId' is required" }, 400);
  }
  const episode = ctx.recorder.save(body.sessionId);
  if (!episode) {
    return json({ type: "error", message: `No open session "${body.sessionId}"` }, 404);
  }
  return json({ status: "saved", id: episode.id, turns: episode.turns.length, threads: episode.threads });
}

/**
 * Route a single request. Pure with respect to `ctx` — no filesystem or config
 * access — so the full HTTP surface is testable without binding a port.
 */
export async function handleRequest(req: Request, ctx: ServeContext): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json({ status: "ok", model: ctx.model });
  }

  if (req.method === "POST" && url.pathname === "/generate") {
    return handleGenerate(req, ctx);
  }

  if (req.method === "POST" && url.pathname === "/episodes/save") {
    return handleEpisodeSave(req, ctx);
  }

  return json({ type: "error", message: "Not found" }, 404);
}
