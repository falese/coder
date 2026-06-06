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
    fetch: (req: Request): Response | Promise<Response> => handleRequest(req, ctx),
  });
  return {
    // Bun types server.port as number | undefined; fall back to the requested port.
    port: server.port ?? port,
    stop: () => {
      server.stop(true);
    },
  };
}
