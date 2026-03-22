import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface HfSibling {
  rfilename: string;
}

interface HfModelInfo {
  siblings?: HfSibling[];
}

export async function streamFileToPath(
  response: Response,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  const total = parseInt(response.headers.get("content-length") ?? "0", 10);
  const writer = Bun.file(destPath).writer();
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      void writer.write(value);
      received += value.byteLength;
      onProgress?.(received, total);
    }
  } finally {
    await writer.end();
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function progressLine(filename: string, received: number, total: number): string {
  if (total > 0) {
    const pct = Math.floor((received / total) * 100);
    return `\r  ${filename}  ${formatBytes(received)} / ${formatBytes(total)}  ${String(pct)}%   `;
  }
  return `\r  ${filename}  ${formatBytes(received)}`;
}

export async function pullModel(repoId: string, modelsDir: string): Promise<void> {
  if (process.env.CODER_DRY_RUN === "1") {
    process.stdout.write(`[dry-run] would pull ${repoId} into ${modelsDir}\n`);
    return;
  }

  const apiUrl = `https://huggingface.co/api/models/${repoId}`;
  const apiResponse = await fetch(apiUrl);
  if (!apiResponse.ok) {
    throw new Error(
      `Failed to fetch model info for ${repoId}: ${String(apiResponse.status)} ${apiResponse.statusText}`,
    );
  }

  const info = (await apiResponse.json()) as HfModelInfo;
  const files = info.siblings ?? [];

  if (files.length === 0) {
    throw new Error(`No files found for model ${repoId}`);
  }

  const modelDir = join(modelsDir, repoId);
  mkdirSync(modelDir, { recursive: true });

  for (const { rfilename } of files) {
    const fileUrl = `https://huggingface.co/${repoId}/resolve/main/${rfilename}`;
    const destPath = join(modelDir, rfilename);
    mkdirSync(dirname(destPath), { recursive: true });

    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download ${rfilename}: ${String(fileResponse.status)}`);
    }

    process.stderr.write(`  ${rfilename}\n`);

    await streamFileToPath(fileResponse, destPath, (received, total) => {
      process.stderr.write(progressLine(rfilename, received, total));
    });

    process.stderr.write("\n");
  }

  process.stdout.write(`\nModel ${repoId} downloaded to ${modelDir}\n`);
}
