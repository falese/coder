import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatPrompt } from "../chat/history.js";
import type { Turn } from "../chat/history.js";
import type { JsonlRecord } from "../data/types.js";
import { stripThreads } from "./threads.js";
import type { Episode } from "./types.js";

/** Persist an episode as `<dir>/<id>.json`; returns the written path. */
export function saveEpisode(dir: string, episode: Episode): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${episode.id}.json`);
  writeFileSync(path, JSON.stringify(episode, null, 2) + "\n");
  return path;
}

/** Load one episode by id, or null when it is absent / unreadable. */
export function loadEpisode(dir: string, id: string): Episode | null {
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Episode;
  } catch {
    return null;
  }
}

/** List all episodes in `dir`, sorted by `startedAt` ascending. Missing dir → []. */
export function listEpisodes(dir: string): Episode[] {
  if (!existsSync(dir)) return [];
  const episodes: Episode[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      episodes.push(JSON.parse(readFileSync(join(dir, file), "utf-8")) as Episode);
    } catch {
      // skip unreadable files
    }
  }
  return episodes.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Bake an episode into `{prompt, completion}` training records — the bridge into
 * the existing `coder data` → `coder adaptor train` pipeline. One record per
 * assistant turn: prompt = the ChatML history up to (and including) the
 * preceding user turn; completion = the assistant's answer with the `<threads>`
 * tag stripped. Reuses `formatPrompt` so the prompt shape matches `coder chat`.
 */
export function episodeToJsonl(episode: Episode): JsonlRecord[] {
  const records: JsonlRecord[] = [];
  const history: Turn[] = [];
  for (const turn of episode.turns) {
    if (turn.role === "assistant") {
      const completion = stripThreads(turn.content).trim();
      if (completion.length > 0 && history.length > 0) {
        records.push({ prompt: formatPrompt(history), completion });
      }
    }
    history.push({ role: turn.role, content: turn.content });
  }
  return records;
}
