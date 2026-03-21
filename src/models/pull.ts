import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface HfSibling {
  rfilename: string;
}

interface HfModelInfo {
  siblings?: HfSibling[];
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

    process.stderr.write(`Downloading ${rfilename}...\n`);
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download ${rfilename}: ${String(fileResponse.status)}`);
    }
    await Bun.write(destPath, fileResponse);
  }

  process.stdout.write(`Model ${repoId} downloaded to ${modelDir}\n`);
}
