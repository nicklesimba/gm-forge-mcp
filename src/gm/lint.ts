import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { parseGameMakerJson, fileExists } from "./yyp.js";
import { readPngDimensions } from "./sprites.js";
import { parseWavMetadata, parseOggMetadata, ALLOWED_SAMPLE_RATES } from "./sounds.js";
import { eventFileNameFromListEntry } from "./objects.js";
import { findProjectTool } from "./gamemaker-tools.js";

const execFileAsync = promisify(execFile);

// Runs GameMaker's own headless validator (ProjectTool.exe) if it's
// installed -- the authoritative check for required-field schema, which the
// semantic checks below don't fully cover on their own. Read-only by
// ProjectTool's own default, so this never writes anything back.
async function runProjectToolCheck(projectDir: string, yypPath: string): Promise<LintIssue[]> {
  const projectToolPath = await findProjectTool();
  if (!projectToolPath) {
    return []; // not installed / not on this machine -- skip gracefully
  }

  try {
    const { stdout } = await execFileAsync(
      projectToolPath,
      ["PROJECT", "OPEN", `SOURCE=${yypPath}`],
      { timeout: 30000 }
    );
    if (stdout.includes("ProjectTool Successful")) {
      return [];
    }
    return [{ severity: "error", message: `GameMaker's own project validator (ProjectTool) failed to load this project:\n${stdout.trim()}` }];
  } catch (e: any) {
    // execFile throws on a nonzero exit code -- ProjectTool exits nonzero
    // specifically when it detects a broken project, which is the case we
    // actually want to catch. Node preserves stdout/stderr on the error, so
    // distinguish "ran and reported a real failure" from "couldn't run it
    // at all" (e.g. a permissions issue) using that.
    const output: string = e.stdout || e.stderr || "";
    if (output.includes("ProjectTool Failed") || output.includes("parsing errors") || output.includes("Error:")) {
      return [{ severity: "error", message: `GameMaker's own project validator (ProjectTool) failed to load this project:\n${output.trim()}` }];
    }
    return [{ severity: "warning", message: `Could not run ProjectTool validation: ${e.message}` }];
  }
}

export interface LintIssue {
  severity: "error" | "warning";
  message: string;
  file?: string;
}

const CATEGORIES = ["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"] as const;

// Never crash the whole check over one file: a real I/O error (permissions,
// a transient lock) becomes a warning for that one resource instead.
async function safeFileExists(p: string, issues: LintIssue[]): Promise<boolean> {
  try {
    return await fileExists(p);
  } catch (e: any) {
    issues.push({ severity: "warning", message: `Could not check whether "${p}" exists: ${e.message}`, file: p });
    return false;
  }
}

async function safeReadYy(p: string): Promise<any | null> {
  try {
    return parseGameMakerJson(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

// Checks: dangling references, missing folder registrations, orphaned
// resource directories, and sound/sprite metadata against the real
// underlying file (a mismatch there can crash the IDE outright). Meant to
// run before trusting a project is safe to open.
export async function lintProject(projectDir: string): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];

  const yypFiles = (await fs.readdir(projectDir)).filter(f => f.endsWith(".yyp"));
  if (yypFiles.length === 0) {
    return [{ severity: "error", message: `No .yyp file found in ${projectDir}` }];
  }
  const yypPath = path.join(projectDir, yypFiles[0]);
  const yyp = await safeReadYy(yypPath);
  if (!yyp) {
    return [{ severity: "error", message: `Failed to parse ${yypPath}`, file: yypFiles[0] }];
  }

  // 0. GameMaker's own authoritative validator, if installed -- catches
  // required-field/schema issues our own checks below don't know about yet.
  issues.push(...(await runProjectToolCheck(projectDir, yypPath)));

  const registeredPaths = new Set<string>((yyp.resources ?? []).map((r: any) => r.id?.path));
  const registeredFolders = new Set<string>((yyp.Folders ?? []).map((f: any) => f.folderPath));
  const nameLower = new Map<string, string[]>();

  // 1. Dangling YYP catalog entries (registered but file missing)
  for (const r of yyp.resources ?? []) {
    const resourcePath = r.id?.path;
    const resourceName = r.id?.name;
    if (!resourcePath || !resourceName) continue;
    if (!(await safeFileExists(path.join(projectDir, resourcePath), issues))) {
      issues.push({ severity: "error", message: `"${resourceName}" is registered in the project but its file is missing`, file: resourcePath });
    }
    const key = resourceName.toLowerCase();
    if (!nameLower.has(key)) nameLower.set(key, []);
    nameLower.get(key)!.push(resourceName);
  }

  // 2. Duplicate names (case-insensitive) across the whole project
  for (const [, names] of nameLower) {
    if (names.length > 1) {
      issues.push({ severity: "error", message: `Duplicate resource name (case-insensitive): ${names.join(", ")} -- GameMaker requires names to be unique across all resource types` });
    }
  }

  // 3. Orphaned resource directories (exist on disk, not registered)
  for (const category of CATEGORIES) {
    const categoryDir = path.join(projectDir, category);
    let entries;
    try {
      entries = await fs.readdir(categoryDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const expectedPath = `${category}/${entry.name}/${entry.name}.yy`;
      if (!registeredPaths.has(expectedPath) && (await safeFileExists(path.join(categoryDir, entry.name, `${entry.name}.yy`), issues))) {
        issues.push({ severity: "warning", message: `"${entry.name}" exists on disk but isn't registered in the project -- it won't show up in the IDE`, file: expectedPath });
      }
    }
  }

  // 4. Missing folder registrations (parent.path not in yyp.Folders). A
  // resource parenting directly to the project's own .yyp is also legal
  // (means "not organized into a folder yet") and isn't a folder reference
  // at all, so it's excluded here rather than flagged.
  for (const r of yyp.resources ?? []) {
    const resourcePath = r.id?.path;
    if (!resourcePath) continue;
    const full = path.join(projectDir, resourcePath);
    const data = await safeReadYy(full);
    if (!data?.parent?.path) continue;
    if (data.parent.path.endsWith(".yyp")) continue;
    if (!registeredFolders.has(data.parent.path)) {
      issues.push({ severity: "error", message: `"${r.id.name}" parents to "${data.parent.path}" but that folder isn't registered -- GameMaker will fail to load this project`, file: resourcePath });
    }
  }

  // 5. Room instances referencing nonexistent objects
  for (const r of yyp.resources ?? []) {
    if (!r.id?.path?.startsWith("rooms/")) continue;
    const room = await safeReadYy(path.join(projectDir, r.id.path));
    if (!room) continue;
    const instanceLayers = (room.layers ?? []).filter((l: any) => l.resourceType === "GMRInstanceLayer");
    for (const layer of instanceLayers) {
      for (const inst of layer.instances ?? []) {
        const objPath = inst.objectId?.path;
        if (objPath && !(await safeFileExists(path.join(projectDir, objPath), issues))) {
          issues.push({ severity: "error", message: `Room "${r.id.name}" places an instance of "${inst.objectId.name}", which doesn't exist`, file: r.id.path });
        }
      }
    }
  }

  // 5.5 Object events whose code file is missing. GameMaker only reads
  // <EventName>_<num>.gml (Collision_<target>.gml for collisions); an
  // eventList entry without its file loads fine but the event is silently
  // empty -- the worst kind of data loss, invisible to every other check.
  for (const r of yyp.resources ?? []) {
    if (!r.id?.path?.startsWith("objects/")) continue;
    const obj = await safeReadYy(path.join(projectDir, r.id.path));
    if (!obj?.eventList) continue;
    for (const entry of obj.eventList) {
      const expected = eventFileNameFromListEntry(entry);
      if (!expected) {
        issues.push({ severity: "warning", message: `Object "${r.id.name}" has an event (type ${entry.eventType}, num ${entry.eventNum}) whose code filename can't be derived -- unknown event type or missing collision target`, file: r.id.path });
        continue;
      }
      if (!(await safeFileExists(path.join(projectDir, "objects", r.id.name, expected), issues))) {
        issues.push({ severity: "error", message: `Object "${r.id.name}" declares a ${expected.replace(".gml", "")} event but ${expected} is missing -- GameMaker will treat the event as empty`, file: r.id.path });
      }
    }
  }

  // 6. Sound metadata vs real WAV file (a mismatch here crashes GameMaker's audio engine on load)
  for (const r of yyp.resources ?? []) {
    if (!r.id?.path?.startsWith("sounds/")) continue;
    const sound = await safeReadYy(path.join(projectDir, r.id.path));
    if (!sound?.soundFile) continue;
    const soundFilePath = path.join(projectDir, "sounds", r.id.name, sound.soundFile);
    if (!(await safeFileExists(soundFilePath, issues))) {
      issues.push({ severity: "error", message: `Sound "${r.id.name}" references audio file "${sound.soundFile}", which doesn't exist`, file: r.id.path });
      continue;
    }
    if (path.extname(sound.soundFile).toLowerCase() === ".wav") {
      try {
        const meta = await parseWavMetadata(soundFilePath);
        if (meta.sampleRate !== sound.sampleRate) {
          issues.push({ severity: "error", message: `Sound "${r.id.name}" declares sampleRate ${sound.sampleRate}Hz but the real file is ${meta.sampleRate}Hz -- this mismatch can crash GameMaker's audio engine on load`, file: r.id.path });
        }
        if (!ALLOWED_SAMPLE_RATES.includes(meta.sampleRate)) {
          issues.push({ severity: "error", message: `Sound "${r.id.name}"'s real file sample rate ${meta.sampleRate}Hz isn't one GameMaker supports`, file: r.id.path });
        }
        const realChannelFormat = meta.channels === 2 ? 1 : 0;
        if (sound.channelFormat !== realChannelFormat) {
          issues.push({ severity: "error", message: `Sound "${r.id.name}" declares channelFormat ${sound.channelFormat} but the real file has ${meta.channels} channel(s)`, file: r.id.path });
        }
      } catch {
        issues.push({ severity: "warning", message: `Sound "${r.id.name}"'s audio file couldn't be parsed as a valid WAV`, file: r.id.path });
      }
    } else if (path.extname(sound.soundFile).toLowerCase() === ".ogg") {
      try {
        const meta = await parseOggMetadata(soundFilePath);
        if (meta.sampleRate !== sound.sampleRate) {
          issues.push({ severity: "error", message: `Sound "${r.id.name}" declares sampleRate ${sound.sampleRate}Hz but the real file is ${meta.sampleRate}Hz -- this mismatch can crash GameMaker's audio engine on load`, file: r.id.path });
        }
        const realChannelFormat = meta.channels === 2 ? 1 : 0;
        if (sound.channelFormat !== realChannelFormat) {
          issues.push({ severity: "error", message: `Sound "${r.id.name}" declares channelFormat ${sound.channelFormat} but the real file has ${meta.channels} channel(s)`, file: r.id.path });
        }
      } catch {
        issues.push({ severity: "warning", message: `Sound "${r.id.name}"'s audio file couldn't be parsed as valid Ogg Vorbis`, file: r.id.path });
      }
    }
  }

  // 7. Sprite dimensions vs real PNG file
  for (const r of yyp.resources ?? []) {
    if (!r.id?.path?.startsWith("sprites/")) continue;
    const sprite = await safeReadYy(path.join(projectDir, r.id.path));
    if (!sprite?.frames?.length) continue;
    const firstFrameName = sprite.frames[0].name;
    const framePath = path.join(projectDir, "sprites", r.id.name, `${firstFrameName}.png`);
    if (!(await safeFileExists(framePath, issues))) {
      issues.push({ severity: "error", message: `Sprite "${r.id.name}" references frame image "${firstFrameName}.png", which doesn't exist`, file: r.id.path });
      continue;
    }
    try {
      const { width, height } = await readPngDimensions(framePath);
      if (width !== sprite.width || height !== sprite.height) {
        issues.push({ severity: "error", message: `Sprite "${r.id.name}" declares ${sprite.width}x${sprite.height} but its real image is ${width}x${height}`, file: r.id.path });
      }
    } catch {
      issues.push({ severity: "warning", message: `Sprite "${r.id.name}"'s frame image couldn't be parsed as a valid PNG`, file: r.id.path });
    }
  }

  // 8. RoomOrderNodes / resources consistency for rooms
  const roomPaths = new Set((yyp.resources ?? []).filter((r: any) => r.id?.path?.startsWith("rooms/")).map((r: any) => r.id.path));
  const orderPaths = new Set((yyp.RoomOrderNodes ?? []).map((n: any) => n.roomId?.path));
  for (const p of roomPaths) {
    if (!orderPaths.has(p)) {
      issues.push({ severity: "warning", message: `Room at "${p}" is registered but missing from RoomOrderNodes`, file: p as string });
    }
  }
  for (const p of orderPaths) {
    if (!roomPaths.has(p)) {
      issues.push({ severity: "error", message: `RoomOrderNodes references "${p}", which isn't a registered room`, file: p as string });
    }
  }

  return issues;
}
