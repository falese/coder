import { runMlxStream } from "../inference/mlx-runner.js";
import { stripFraming, parseChannels } from "./clean.js";

/**
 * Local SSE inference server context.
 *
 * Holds the already-resolved model / adaptor so request handling stays pure:
 * the handler never touches config or the filesystem, which keeps it trivially
 * unit-testable with a constructed `Request`.
 */
export interface ServeContext {
  model: string;
  adaptorPath?: string;
  dryRun: boolean;
}

interface GenerateBody {
  prompt?: unknown;
  system?: unknown;
  maxTokens?: unknown;
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

function buildGenerateResponse(prompt: string, system: string | undefined, maxTokens: number, ctx: ServeContext): Response {
  const { stream: tokenStream, result } = runMlxStream({
    model: ctx.model,
    prompt,
    maxTokens,
    dryRun: ctx.dryRun,
    adaptor: ctx.adaptorPath,
    systemFile: system,
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

  if (typeof body.prompt !== "string" || body.prompt.length === 0) {
    return json({ type: "error", message: "Field 'prompt' is required" }, 400);
  }

  const system = typeof body.system === "string" ? body.system : undefined;
  const maxTokens = typeof body.maxTokens === "number" ? body.maxTokens : 512;

  return buildGenerateResponse(body.prompt, system, maxTokens, ctx);
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

  return json({ type: "error", message: "Not found" }, 404);
}
