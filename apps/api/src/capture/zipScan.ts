import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { ensureDir } from "../utils/fs.js";

export async function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
  await ensureDir(path.dirname(outputPath));

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 9 }
    });

    output.on("close", () => resolve());
    archive.on("error", (error) => reject(error));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}
