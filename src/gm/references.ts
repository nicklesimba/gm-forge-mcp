import { promises as fs } from "fs";
import path from "path";

export interface ReferenceHit {
  file: string;
  line: number;
  context: string;
}

const SEARCHABLE_EXTENSIONS = [".yy", ".yyp", ".gml"];

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else if (SEARCHABLE_EXTENSIONS.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// Finds every mention of a resource name across the project: structured
// references in .yy files (objectId, spriteId, parent, instances) and plain
// text in .gml code. Whole-word text match, no JSON-structure-awareness --
// this feeds destructive-action safety checks, so over-reporting beats
// missing a real reference. The project's own .yyp is skipped: it lists
// every resource by definition, so that match is bookkeeping, not usage.
export async function findReferences(
  projectDir: string,
  resourceName: string,
  excludeOwnFiles: boolean = true
): Promise<ReferenceHit[]> {
  if (!resourceName || resourceName.trim().length === 0) {
    throw new Error("resourceName cannot be empty -- an empty search matches almost every line in the project");
  }
  const wordBoundary = new RegExp(`\\b${resourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const ownPathFragment = `${path.sep}${resourceName}${path.sep}`;

  const files = (await walkFiles(projectDir)).filter(f => path.extname(f) !== ".yyp");
  const hits: ReferenceHit[] = [];

  for (const file of files) {
    if (excludeOwnFiles && file.includes(ownPathFragment)) continue;

    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (wordBoundary.test(lines[i])) {
        hits.push({
          file: path.relative(projectDir, file),
          line: i + 1,
          context: lines[i].trim().slice(0, 200)
        });
      }
    }
  }

  return hits;
}
