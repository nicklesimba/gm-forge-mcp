import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { findReferences, type ReferenceHit } from "./references.js";
import { assertSafeResourceName } from "./yyp.js";

export type ResourceCategory = "rooms" | "objects" | "scripts" | "sprites" | "shaders" | "sounds" | "fonts" | "notes" | "tilesets" | "extensions" | "particles" | "animcurves";

export class ResourceInUseError extends Error {
  constructor(public resourceName: string, public references: ReferenceHit[]) {
    super(
      `"${resourceName}" is still referenced in ${references.length} place(s) -- refusing to delete. ` +
      `Pass force=true if you're sure. First few references:\n` +
      references.slice(0, 5).map(r => `  ${r.file}:${r.line}  ${r.context}`).join("\n")
    );
  }
}

/**
 * Delete an existing resource. Refuses to delete anything still referenced
 * elsewhere in the project (rooms placing an object instance, other objects
 * parenting to it, GML code calling a script, etc.) unless force=true --
 * deleting something still in use is exactly the kind of change that looks
 * fine until GameMaker tries to load/link the project and fails.
 */
export async function deleteResource(
  projectDir: string,
  yyp: Yyp,
  category: ResourceCategory,
  resourceName: string,
  force: boolean = false
): Promise<Yyp> {
  assertSafeResourceName(resourceName);
  const dir = path.join(projectDir, category, resourceName);
  const yyPath = path.join(dir, `${resourceName}.yy`);
  try {
    await fs.access(yyPath);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`${category.slice(0, -1)} "${resourceName}" does not exist (expected ${yyPath})`);
    }
    throw new Error(`Failed to access ${category.slice(0, -1)} "${resourceName}" at ${yyPath}: ${e.message}`);
  }

  if (!force) {
    const references = await findReferences(projectDir, resourceName);
    if (references.length > 0) {
      throw new ResourceInUseError(resourceName, references);
    }
  }

  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e: any) {
    // The catalog is only updated below, AFTER this succeeds -- so a
    // failure here (a locked file mid-directory, say) leaves the catalog
    // untouched. What it can't guarantee is that the directory itself
    // wasn't partially cleared before hitting the failure.
    const stillExists = await fs.access(dir).then(() => true, () => false);
    throw new Error(
      stillExists
        ? `Failed to fully delete "${resourceName}" -- it may be partially removed. Run lint_project to check, then retry: ${e.message}`
        : `Failed to delete "${resourceName}": ${e.message}`
    );
  }

  const resourcePath = `${category}/${resourceName}/${resourceName}.yy`;
  yyp.resources = yyp.resources.filter((r: any) => r.id?.path !== resourcePath);

  if (category === "rooms") {
    const orderNodes = (yyp as any).RoomOrderNodes ?? [];
    (yyp as any).RoomOrderNodes = orderNodes.filter((n: any) => n.roomId?.path !== resourcePath);
  }

  return yyp;
}
