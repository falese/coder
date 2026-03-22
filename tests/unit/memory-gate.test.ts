import { describe, test, expect, spyOn } from "bun:test";
import { checkMemory } from "../../src/inference/memory-gate.js";
import { logger } from "../../src/observability/logger.js";

const GB = 1_000_000_000;
const MOCK_18GB = () => Promise.resolve(18 * GB);

async function doesThrow(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

describe("checkMemory", () => {
  test("resolves when estimated memory is well under 18 GB", async () => {
    // 4 GB model disk × 1.2 = 4.8 GB estimated — well within 18 GB limit
    await checkMemory(4 * GB, 0, MOCK_18GB);
    // no throw = pass
  });

  test("throws with actionable message when estimate exceeds 18 GB", async () => {
    // 16 GB disk × 1.2 = 19.2 GB → over 18 GB limit
    let errorMsg = "";
    try {
      await checkMemory(16 * GB, 0, MOCK_18GB);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    expect(errorMsg).toContain("18");
  });

  test("exactly 15 GB disk × 1.2 = 18 GB does not throw; 15.1 GB does", async () => {
    expect(await doesThrow(() => checkMemory(15 * GB, 0, MOCK_18GB))).toBe(false);
    expect(await doesThrow(() => checkMemory(15.1 * GB, 0, MOCK_18GB))).toBe(true);
  });

  test("includes adaptor bytes in estimate — safe total does not throw", async () => {
    // 13 GB disk × 1.2 = 15.6 GB + 4 MB adaptor = ~15.6 GB, well under 18 GB
    const adaptorBytes = 4 * 1_000_000;
    await checkMemory(13 * GB, adaptorBytes, MOCK_18GB);
    // no throw = pass
  });

  test("resolves immediately when CODER_DRY_RUN=1 regardless of size", async () => {
    const prev = process.env.CODER_DRY_RUN;
    process.env.CODER_DRY_RUN = "1";
    try {
      // Would exceed 18 GB limit without dry-run bypass
      expect(await doesThrow(() => checkMemory(100 * GB, 0, MOCK_18GB))).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.CODER_DRY_RUN;
      } else {
        process.env.CODER_DRY_RUN = prev;
      }
    }
  });

  test("calls logger.warn when headroom is under 2 GB", async () => {
    // System: 18 GB. Estimate: 14 GB disk × 1.2 = 16.8 GB. Headroom = 1.2 GB < 2 GB
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      await checkMemory(14 * GB, 0, MOCK_18GB);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("does not warn when headroom is over 2 GB", async () => {
    // System: 18 GB. Estimate: 4 GB × 1.2 = 4.8 GB. Headroom = 13.2 GB
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      await checkMemory(4 * GB, 0, MOCK_18GB);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
