import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { findReferences } from "./references.js";
import type { ResourceCategory } from "./delete.js";
import { assertSafeResourceName, parseGameMakerJson, fileExists } from "./yyp.js";

/**
 * Whole-word text replace for .gml files -- best-effort without a real GML
 * parser (documented limitation, see renameInFile). One scoped mitigation:
 * a line declaring a local variable with the exact old name ("var oldName"
 * or "var oldName = ...") is left untouched entirely, since that's a
 * shadowing local, not a reference to the resource. This does NOT track
 * that local's later usages within the same scope -- doing so needs real
 * scope analysis -- so it reduces the false-positive-rename surface rather
 * than eliminating it.
 */
function wholeWordReplace(content: string, oldName: string, newName: string): string {
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordBoundary = new RegExp(`\\b${escaped}\\b`, "g");
  const varDeclaration = new RegExp(`\\bvar\\s+${escaped}\\b`);

  return content.replace(/^.*$/gm, line => varDeclaration.test(line) ? line : line.replace(wordBoundary, newName));
}

/**
 * A path/filename-shaped value (a "path" field, or a self-referencing file
 * like a room's creationCodeFile or a sound's soundFile) always contains a
 * "/" or ".". A plain free-text label ("Instances", "default") has neither,
 * so it's left alone rather than risk a substring rename inside it.
 */
function renamePathLikeValue(value: string, oldName: string, newName: string): string {
  if (!value.includes("/") && !value.includes(".")) return value;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`\\b${escaped}\\b`, "g"), newName);
}

// GameMaker's own reference shape is always a {name, path} pair sitting
// together on one object (objectId, spriteId, parentObjectId, a room's
// parent folder, etc.) -- checking for that shape is what stops a "name"
// field from being renamed just because a completely unrelated object (a
// room layer's own label, say) happens to have a "name" of its own with a
// coincidentally matching value.
function isReferencePair(obj: Record<string, unknown>): boolean {
  return typeof obj.name === "string" && typeof obj.path === "string";
}

function renameInJsonTree(node: unknown, oldName: string, newName: string, isRoot: boolean): unknown {
  if (Array.isArray(node)) return node.map(item => renameInJsonTree(item, oldName, newName, false));
  if (!node || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  const referencePair = isReferencePair(obj);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string") {
      out[key] = renameInJsonTree(value, oldName, newName, false);
      continue;
    }
    const isIdentityKey = key === "name" || key === "%Name";
    if (isIdentityKey) {
      out[key] = (isRoot || referencePair) && value === oldName ? newName : value;
    } else {
      out[key] = renamePathLikeValue(value, oldName, newName);
    }
  }
  return out;
}

/**
 * Rename every reference to oldName inside a .yy file's structured JSON,
 * rather than a blind text replace -- this is what keeps an unrelated
 * same-named identifier elsewhere in the file from being renamed too. GML
 * (.gml) files have no equivalent structure to walk, so those still go
 * through wholeWordReplace as a best-effort text match -- an unrelated local
 * variable sharing the exact resource name is a known, inherent limitation
 * of text-based GML rewriting without a real GML parser.
 */
function renameInYyFile(content: string, oldName: string, newName: string): string {
  const parsed = parseGameMakerJson(content);
  return JSON.stringify(renameInJsonTree(parsed, oldName, newName, true), null, 2);
}

function renameInFile(content: string, ext: string, oldName: string, newName: string): string {
  return ext === ".yy" ? renameInYyFile(content, oldName, newName) : wholeWordReplace(content, oldName, newName);
}

/**
 * Rename an existing resource, rewriting every reference to it across the
 * whole project (other .yy files' name/path references, .gml code calling
 * it) plus the resource's own files and internal name fields. This is the
 * riskiest writer in the project -- a missed reference leaves a dangling
 * pointer GameMaker won't be able to resolve, so every step that touches
 * files is deliberately narrow (whole-word match only) and the whole
 * operation refuses up front if anything about the new name is invalid.
 */
export async function renameResource(
  projectDir: string,
  yyp: Yyp,
  category: ResourceCategory,
  oldName: string,
  newName: string
): Promise<Yyp> {
  assertSafeResourceName(oldName);
  if (oldName === newName) {
    throw new Error("New name is identical to the old name");
  }
  assertSafeResourceName(newName);
  const lowerNew = newName.toLowerCase();
  const collision = yyp.resources.some((r: any) => r.id?.name?.toLowerCase() === lowerNew);
  if (collision) {
    throw new Error(`A resource named "${newName}" already exists in this project`);
  }

  const oldDir = path.join(projectDir, category, oldName);
  const newDir = path.join(projectDir, category, newName);
  if (!(await fileExists(path.join(oldDir, `${oldName}.yy`)))) {
    throw new Error(`${category.slice(0, -1)} "${oldName}" does not exist (expected ${oldDir})`);
  }
  if (await fileExists(newDir)) {
    throw new Error(`Target directory already exists: ${newDir}`);
  }

  // Steps 1-4 touch real files on disk in a specific order; if any of them
  // throws partway through (a locked file, a permissions error), everything
  // already done gets rolled back in reverse before the error propagates --
  // otherwise a partial failure here leaves external files pointing at
  // newName while the resource's own directory is still named oldName (or
  // half-renamed), with no catalog update to even make sense of it.
  const modifiedExternalFiles: { file: string; originalContent: string }[] = [];
  const modifiedOwnFiles: { filePath: string; originalContent: string }[] = [];
  const renamedOwnFiles: { from: string; to: string }[] = [];
  let directoryRenamed = false;

  try {
    // 1. Rewrite every EXTERNAL reference (other files pointing at this resource)
    const externalRefs = await findReferences(projectDir, oldName, true);
    const externalFiles = [...new Set(externalRefs.map(r => path.join(projectDir, r.file)))];
    for (const file of externalFiles) {
      const content = await fs.readFile(file, "utf8");
      modifiedExternalFiles.push({ file, originalContent: content });
      await fs.writeFile(file, renameInFile(content, path.extname(file), oldName, newName), "utf8");
    }

    // 2. Rewrite the resource's OWN file contents (its "name"/"%Name" fields,
    //    and any self-referencing paths like a room's creationCodeFile)
    const ownFiles = await fs.readdir(oldDir);
    for (const fileName of ownFiles) {
      const filePath = path.join(oldDir, fileName);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const ext = path.extname(fileName);
      if (![".yy", ".gml"].includes(ext)) continue;
      const content = await fs.readFile(filePath, "utf8");
      modifiedOwnFiles.push({ filePath, originalContent: content });
      await fs.writeFile(filePath, renameInFile(content, ext, oldName, newName), "utf8");
    }

    // 3. Rename the resource's own files (oldName.yy -> newName.yy,
    //    oldName.gml -> newName.gml, oldName_<type>_<num>.gml event stubs, etc.)
    for (const fileName of ownFiles) {
      // Collision_<ownName>.gml is a self-collision event -- its target name
      // is the filename's suffix, not its prefix, so it needs its own case.
      const newFileName = fileName === `Collision_${oldName}.gml`
        ? `Collision_${newName}.gml`
        : fileName.startsWith(oldName)
          ? `${newName}${fileName.slice(oldName.length)}`
          : null;
      if (newFileName) {
        const from = path.join(oldDir, fileName);
        const to = path.join(oldDir, newFileName);
        await fs.rename(from, to);
        renamedOwnFiles.push({ from, to });
      }
    }

    // 3.5 For objects: other objects' Collision events against this one
    //     store the target in the FILENAME (Collision_<target>.gml), not
    //     just in .yy content -- step 1 rewrote the content references, but
    //     the files themselves still need renaming or GameMaker stops
    //     reading their code.
    if (category === "objects") {
      const objectsRoot = path.join(projectDir, "objects");
      let otherObjects: string[] = [];
      try {
        otherObjects = (await fs.readdir(objectsRoot, { withFileTypes: true }))
          .filter(e => e.isDirectory() && e.name !== oldName)
          .map(e => e.name);
      } catch { /* no objects dir -- nothing referencing us by filename */ }
      for (const other of otherObjects) {
        const from = path.join(objectsRoot, other, `Collision_${oldName}.gml`);
        if (await fileExists(from)) {
          const to = path.join(objectsRoot, other, `Collision_${newName}.gml`);
          await fs.rename(from, to);
          renamedOwnFiles.push({ from, to });
        }
      }
    }

    // 4. Rename the resource's own directory
    await fs.rename(oldDir, newDir);
    directoryRenamed = true;
  } catch (originalError: any) {
    const rollbackErrors: string[] = [];
    if (directoryRenamed) {
      try { await fs.rename(newDir, oldDir); } catch (e: any) { rollbackErrors.push(`restore directory: ${e.message}`); }
    }
    for (const { from, to } of [...renamedOwnFiles].reverse()) {
      try { await fs.rename(to, from); } catch (e: any) { rollbackErrors.push(`restore ${to}: ${e.message}`); }
    }
    for (const { filePath, originalContent } of modifiedOwnFiles) {
      try { await fs.writeFile(filePath, originalContent, "utf8"); } catch (e: any) { rollbackErrors.push(`restore ${filePath}: ${e.message}`); }
    }
    for (const { file, originalContent } of modifiedExternalFiles) {
      try { await fs.writeFile(file, originalContent, "utf8"); } catch (e: any) { rollbackErrors.push(`restore ${file}: ${e.message}`); }
    }
    if (rollbackErrors.length === 0) {
      throw new Error(`Rename failed and was fully rolled back -- no changes were left in place. Original error: ${originalError.message}`);
    }
    throw new Error(
      `Rename failed partway through, and rollback ALSO hit errors -- the project may be left in a partially-renamed state. ` +
      `Run lint_project to check. Original error: ${originalError.message}. Rollback errors: ${rollbackErrors.join("; ")}`
    );
  }

  // 5. Update the YYP catalog entry
  const oldResourcePath = `${category}/${oldName}/${oldName}.yy`;
  const newResourcePath = `${category}/${newName}/${newName}.yy`;
  for (const r of yyp.resources as any[]) {
    if (r.id?.path === oldResourcePath) {
      r.id.name = newName;
      r.id.path = newResourcePath;
    }
  }

  // 6. Update RoomOrderNodes for rooms
  if (category === "rooms") {
    const orderNodes = ((yyp as any).RoomOrderNodes ?? []) as any[];
    for (const n of orderNodes) {
      if (n.roomId?.path === oldResourcePath) {
        n.roomId.name = newName;
        n.roomId.path = newResourcePath;
      }
    }
  }

  return yyp;
}
