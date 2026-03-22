import { logger } from "../observability/logger.js";

const HARD_LIMIT_BYTES = 18 * 1_000_000_000;
const WARN_HEADROOM_BYTES = 2 * 1_000_000_000;

export async function getSystemMemoryBytes(): Promise<number> {
  const proc = Bun.spawn(["sysctl", "hw.memsize"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const match = stdout.match(/hw\.memsize:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not parse hw.memsize from sysctl output: ${stdout}`);
  }
  return parseInt(match[1], 10);
}

export async function checkMemory(
  modelDiskBytes: number,
  adaptorBytes: number,
  getSystemMem: () => Promise<number> = getSystemMemoryBytes,
): Promise<void> {
  if (process.env.CODER_DRY_RUN === "1") return;

  const estimatedBytes = modelDiskBytes * 1.2 + adaptorBytes;

  if (estimatedBytes > HARD_LIMIT_BYTES) {
    const estimatedGb = (estimatedBytes / 1e9).toFixed(1);
    throw new Error(
      `Model requires ~${estimatedGb} GB but the 18 GB limit would be exceeded. ` +
        `Use a smaller or more quantized model.`,
    );
  }

  const systemBytes = await getSystemMem();
  const headroom = systemBytes - estimatedBytes;

  if (headroom < WARN_HEADROOM_BYTES) {
    const headroomGb = (headroom / 1e9).toFixed(1);
    logger.warn(
      `Low memory headroom: ~${headroomGb} GB remaining after model load`,
    );
  }
}
