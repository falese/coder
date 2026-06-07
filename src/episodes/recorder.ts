import { randomUUID } from "node:crypto";
import { saveEpisode } from "./store.js";
import type { Episode } from "./types.js";

/** One completed request/response exchange to fold into a session's episode. */
export interface RecordExchange {
  userContent: string;
  final: string;
  thought?: string;
  threads?: string[];
}

/**
 * Accumulates exchanges per `sessionId` and flushes them to disk as episodes.
 * Injected into the serve handler so request handling stays pure and testable.
 */
export interface SessionRecorder {
  record(sessionId: string, ex: RecordExchange): void;
  /** Flush one session to disk; returns the saved episode, or null if unknown. */
  save(sessionId: string): Episode | null;
  /** Flush sessions whose last activity is older than `idleMs`. */
  flushIdle(nowMs: number, idleMs: number): Episode[];
  /** Flush every open session (shutdown). */
  flushAll(): Episode[];
  has(sessionId: string): boolean;
}

interface OpenSession {
  episode: Episode;
  lastActivityMs: number;
}

function mergeThreads(into: string[], incoming: string[]): void {
  const seen = new Set(into);
  for (const t of incoming) {
    if (!seen.has(t)) {
      seen.add(t);
      into.push(t);
    }
  }
}

export interface RecorderOptions {
  dir: string;
  model: string;
  adaptor?: string;
  /** Clock injection for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

/** Create a disk-backed session recorder rooted at `opts.dir`. */
export function createSessionRecorder(opts: RecorderOptions): SessionRecorder {
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, OpenSession>();

  function ensure(sessionId: string): OpenSession {
    let s = sessions.get(sessionId);
    if (!s) {
      const ts = new Date(now()).toISOString();
      const episode: Episode = {
        id: randomUUID(),
        sessionId,
        startedAt: ts,
        endedAt: ts,
        model: opts.model,
        ...(opts.adaptor !== undefined ? { adaptor: opts.adaptor } : {}),
        turns: [],
        threads: [],
      };
      s = { episode, lastActivityMs: now() };
      sessions.set(sessionId, s);
    }
    return s;
  }

  return {
    record(sessionId, ex) {
      const s = ensure(sessionId);
      const ts = new Date(now()).toISOString();
      s.episode.turns.push({ role: "user", content: ex.userContent, ts });
      s.episode.turns.push({
        role: "assistant",
        content: ex.final,
        ...(ex.thought !== undefined ? { thought: ex.thought } : {}),
        ...(ex.threads !== undefined ? { threads: ex.threads } : {}),
        ts,
      });
      if (ex.threads && ex.threads.length > 0) mergeThreads(s.episode.threads, ex.threads);
      s.episode.endedAt = ts;
      s.lastActivityMs = now();
    },

    save(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return null;
      saveEpisode(opts.dir, s.episode);
      sessions.delete(sessionId);
      return s.episode;
    },

    flushIdle(nowMs, idleMs) {
      const flushed: Episode[] = [];
      for (const [id, s] of sessions) {
        if (nowMs - s.lastActivityMs >= idleMs) {
          saveEpisode(opts.dir, s.episode);
          sessions.delete(id);
          flushed.push(s.episode);
        }
      }
      return flushed;
    },

    flushAll() {
      const flushed: Episode[] = [];
      for (const [, s] of sessions) {
        saveEpisode(opts.dir, s.episode);
        flushed.push(s.episode);
      }
      sessions.clear();
      return flushed;
    },

    has(sessionId) {
      return sessions.has(sessionId);
    },
  };
}
