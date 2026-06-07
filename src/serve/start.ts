import { handleRequest, type ServeContext } from "./server.js";

export interface RunningServer {
  port: number;
  stop: () => void;
}

/**
 * Bind `handleRequest` to a port via `Bun.serve`. Returns a handle so callers
 * (and tests) can read the resolved port and shut the server down. Pass
 * `port: 0` for an ephemeral port.
 */
export function startServer(ctx: ServeContext, port: number): RunningServer {
  const server = Bun.serve({
    port,
    // Disable Bun's default 10s idle timeout: model load + generation regularly
    // produce no socket bytes for longer than that before the first token, and a
    // streamed response can run well past 10s. 0 = no idle timeout.
    idleTimeout: 0,
    fetch: (req: Request): Response | Promise<Response> => handleRequest(req, ctx),
  });
  return {
    // Bun types server.port as number | undefined; fall back to the requested port.
    port: server.port ?? port,
    stop: () => {
      void server.stop(true);
    },
  };
}
