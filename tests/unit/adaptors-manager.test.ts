import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listAdaptors,
  readManifest,
  removeAdaptor,
  installAdaptor,
  updateAdaptor,
} from "../../src/adaptors/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MANIFEST = {
  name: "react-ts",
  version: "1.0.0",
  domain: "frontend",
  base_model: "Qwen2.5-Coder-7B",
  mlx_quant: "4bit",
  lora_rank: 8,
  min_memory_gb: 18,
  eval_pass_rate: 0.85,
  author: "test",
  description: "A test adaptor",
};

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeMockProcess(stdout: string, stderr: string, exitCode: number) {
  return {
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    exited: Promise.resolve(exitCode),
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "coder-adaptor-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// listAdaptors
// ---------------------------------------------------------------------------

describe("listAdaptors", () => {
  test("returns empty array when adaptors dir does not exist", () => {
    const result = listAdaptors(join(tempDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  test("returns empty array when dir exists but has no subdirs with manifest", () => {
    mkdirSync(tempDir, { recursive: true });
    const result = listAdaptors(tempDir);
    expect(result).toEqual([]);
  });

  test("returns entry for a valid adaptor directory", () => {
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(join(adaptorDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));

    const result = listAdaptors(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("react-ts");
    expect(result[0].manifest.version).toBe("1.0.0");
  });

  test("ignores subdirectories without manifest.json", () => {
    mkdirSync(join(tempDir, "no-manifest"), { recursive: true });
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(join(adaptorDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));

    const result = listAdaptors(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("react-ts");
  });
});

// ---------------------------------------------------------------------------
// readManifest
// ---------------------------------------------------------------------------

describe("readManifest", () => {
  test("parses a valid manifest", () => {
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(join(adaptorDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));

    const manifest = readManifest(adaptorDir);
    expect(manifest.name).toBe("react-ts");
    expect(manifest.lora_rank).toBe(8);
  });

  test("throws on missing required field", () => {
    const adaptorDir = join(tempDir, "bad");
    mkdirSync(adaptorDir, { recursive: true });
    // Omit required 'name' field by building object without it
    const withoutName = Object.fromEntries(
      Object.entries(VALID_MANIFEST).filter(([k]) => k !== "name"),
    );
    writeFileSync(join(adaptorDir, "manifest.json"), JSON.stringify(withoutName));

    let threw = false;
    try {
      readManifest(adaptorDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("throws on invalid JSON", () => {
    const adaptorDir = join(tempDir, "bad");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(join(adaptorDir, "manifest.json"), "not valid json");

    let threw = false;
    try {
      readManifest(adaptorDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("throws when manifest.json does not exist", () => {
    const adaptorDir = join(tempDir, "empty");
    mkdirSync(adaptorDir, { recursive: true });

    let threw = false;
    try {
      readManifest(adaptorDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeAdaptor
// ---------------------------------------------------------------------------

describe("removeAdaptor", () => {
  test("removes the adaptor directory", () => {
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });
    writeFileSync(join(adaptorDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));

    removeAdaptor("react-ts", tempDir);

    expect(existsSync(adaptorDir)).toBe(false);
  });

  test("throws if adaptor directory does not exist", () => {
    let threw = false;
    try {
      removeAdaptor("nonexistent", tempDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// installAdaptor (mocked git)
// ---------------------------------------------------------------------------

describe("installAdaptor", () => {
  test("clones and validates on success", async () => {
    // Pre-create the dir with a valid manifest (simulating what git clone would do)
    const destDir = join(tempDir, "react-ts");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), JSON.stringify(VALID_MANIFEST));

    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await installAdaptor("react-ts", "file:///fake/url", tempDir);
      expect(existsSync(destDir)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("cleans up dest dir when manifest is invalid", async () => {
    // Pre-create the dir with an invalid manifest
    const destDir = join(tempDir, "bad");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "manifest.json"), JSON.stringify({ name: "" }));

    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    let threw = false;
    try {
      await installAdaptor("bad", "file:///fake/url", tempDir);
    } catch {
      threw = true;
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
    expect(existsSync(destDir)).toBe(false);
  });

  test("throws when git clone fails", async () => {
    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "fatal: repository not found", 128) as ReturnType<typeof Bun.spawn>,
    );
    let threw = false;
    let message = "";
    try {
      await installAdaptor("react-ts", "file:///bad/url", tempDir);
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
    expect(message).toContain("repository not found");
  });
});

// ---------------------------------------------------------------------------
// updateAdaptor (mocked git)
// ---------------------------------------------------------------------------

describe("updateAdaptor", () => {
  test("runs git pull in the adaptor directory", async () => {
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });

    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("Already up to date.", "", 0) as ReturnType<typeof Bun.spawn>,
    );
    try {
      await updateAdaptor("react-ts", tempDir);
    } finally {
      spy.mockRestore();
    }
    // no throw = pass
  });

  test("throws if adaptor directory does not exist", async () => {
    let threw = false;
    try {
      await updateAdaptor("nonexistent", tempDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("throws when git pull fails", async () => {
    const adaptorDir = join(tempDir, "react-ts");
    mkdirSync(adaptorDir, { recursive: true });

    const spy = spyOn(Bun, "spawn").mockReturnValue(
      makeMockProcess("", "error: could not fetch", 1) as ReturnType<typeof Bun.spawn>,
    );
    let threw = false;
    try {
      await updateAdaptor("react-ts", tempDir);
    } catch {
      threw = true;
    } finally {
      spy.mockRestore();
    }
    expect(threw).toBe(true);
  });
});
