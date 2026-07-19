import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { Yy, type Yyp } from "@bscotch/yy";

const YYP_NAME = (name: string) => `${name}.yyp`;

// resourceVersion strings, captured from real GameMaker output. Kept per
// type rather than one shared constant since GameMaker versions each
// sub-structure independently and a future bump likely won't hit all of them
// at once.
export const RESOURCE_VERSIONS = {
  project: "2.0",
  folder: "2.0",
  audioGroup: "2.0",
  textureGroup: "1.3",
  script: "2.0",
  object: "2.0",
  event: "2.0",
  room: "2.0",
  roomInstanceLayer: "2.0",
  roomBackgroundLayer: "2.0",
  roomInstance: "2.0",
  sprite: "2.0",
  spriteFrame: "2.0",
  spriteLayer: "2.0",
  spriteSequence: "2.0",
  spriteFramesTrack: "2.0",
  spriteFrameKeyframe: "2.0",
  spriteMomentsKeyframes: "2.0",
  spriteMessageKeyframes: "2.0",
  shader: "2.0",
  sound: "2.0",
  font: "2.0",
  note: "2.0",
  tileset: "2.0",
  extension: "2.0",
  particleSystem: "1.0",
  particleEmitter: "1.0",
  animCurve: "1.2",
  animCurveChannel: "1.0",
} as const;

const projectQueues = new Map<string, Promise<unknown>>();

// Two spellings of the same directory ("C:\Foo" vs "c:/foo/") must map to
// one queue, or the lock silently doesn't serialize them. Windows paths are
// case-insensitive, hence the lowercasing there.
function lockKey(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

// Serializes operations per project directory. Two calls racing a
// loadYyp -> mutate -> writeYyp cycle would otherwise clobber each other:
// whoever writes last wins, silently discarding the other's changes.
// Read-only calls get queued here too since it's cheap and one less thing
// callers have to reason about.
export function withProjectLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(projectDir);
  const tail = projectQueues.get(key) ?? Promise.resolve();
  const result = tail.then(fn, fn);
  projectQueues.set(key, result.then(() => undefined, () => undefined));
  return result;
}

// A permissions issue or transient lock isn't "doesn't exist" -- only
// ENOENT is.
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (e: any) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

// For reading a resource's own .yy (room/object/script/sprite -- the
// project .yyp itself goes through Yy.read instead). GameMaker resaves
// files with trailing commas, which plain JSON.parse rejects, so strip
// those first. The stripping is string-aware: a "," followed by "]" or "}"
// INSIDE a quoted value (a note title, a description) is real content, and
// a naive regex would corrupt it.
export function parseGameMakerJson(text: string): any {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        i++;
        if (i < text.length) out += text[i];
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "]" || text[j] === "}") continue; // trailing comma -- drop it
    }
    out += ch;
  }
  return JSON.parse(out);
}

/**
 * Create a new GameMaker project scaffold if it doesn't exist
 */
export async function ensureProjectScaffold(projectDir: string, name: string): Promise<Yyp> {
  assertSafeProjectName(name);
  await fs.mkdir(projectDir, { recursive: true });
  const yypPath = path.join(projectDir, YYP_NAME(name));

  if (await fileExists(yypPath)) {
    return await Yy.read(yypPath, Yy.schemas.project) as Yyp;
  }

  // A directory that already holds a DIFFERENT project must not get a second
  // manifest -- GameMaker (and loadYyp) can't tell which one is "the" project.
  const existingYyp = (await fs.readdir(projectDir)).find(f => f.endsWith(".yyp"));
  if (existingYyp) {
    throw new Error(`${projectDir} already contains a different project (${existingYyp}) -- refusing to create a second .yyp next to it`);
  }
  
  // Matches a real GameMaker-created project's top-level shape exactly
  // (captured from Convoy) -- Options/isDnDProject/tutorialPath are all
  // legitimately absent on a real project, not just defaulted, so they're
  // omitted here too rather than filled with placeholder values.
  const yyp: Partial<Yyp> = {
    "$GMProject": "v1",
    "%Name": name,
    name,
    resourceType: "GMProject",
    resources: [],
    RoomOrderNodes: [],
    Folders: [],
    AudioGroups: [
      {
        targets: BigInt(-1),
        resourceVersion: RESOURCE_VERSIONS.audioGroup,
        name: "audiogroup_default",
        resourceType: "GMAudioGroup"
      }
    ],
    TextureGroups: [
      {
        isScaled: true,
        autocrop: true,
        border: 2,
        mipsToGenerate: 0,
        groupParent: null,
        targets: BigInt(-1),
        resourceVersion: RESOURCE_VERSIONS.textureGroup,
        name: "Default",
        resourceType: "GMTextureGroup",
        customOptions: "",
        compressFormat: "bz2",
        loadType: "default",
        directory: ""
      }
    ],
    IncludedFiles: [],
    MetaData: {
      IDEVersion: "2024.14.4.222"
    },
    ForcedPrefabProjectReferences: [],
    LibraryEmitters: [],
    defaultScriptType: 0,
    isEcma: false,
    templateType: "game",
    configs: {
      name: "Default",
      children: []
    },
    resourceVersion: RESOURCE_VERSIONS.project
  } as any;
  
  return yyp as Yyp;
}

/**
 * Load an existing YYP from a project directory
 */
export async function loadYyp(projectDir: string): Promise<Yyp> {
  const files = await fs.readdir(projectDir);
  const yypFiles = files.filter((f: string) => f.endsWith(".yyp"));

  if (yypFiles.length === 0) {
    throw new Error(`No .yyp found in ${projectDir}`);
  }
  if (yypFiles.length > 1) {
    throw new Error(`${projectDir} contains ${yypFiles.length} .yyp files (${yypFiles.join(", ")}) -- can't tell which is the project; remove the extra one`);
  }

  const fullPath = path.join(projectDir, yypFiles[0]);
  return await Yy.read(fullPath, Yy.schemas.project) as Yyp;
}

// Writes to a temp file and renames over the real path. Yy.write on its own
// writes straight onto the target, so a crash mid-write leaves the whole
// project's manifest truncated; the rename is atomic, so there's no window
// where that can happen here.
export async function writeYyp(projectDir: string, yyp: Yyp): Promise<void> {
  const filename = yyp.name.endsWith(".yyp") ? yyp.name : `${yyp.name}.yyp`;
  const fullPath = path.join(projectDir, filename);
  const tempPath = path.join(projectDir, `.${filename}.tmp-${crypto.randomUUID()}`);
  try {
    await Yy.write(tempPath, yyp, Yy.schemas.project);
    await fs.rename(tempPath, fullPath);
  } catch (e) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw e;
  }
}

// Format check only, no collision check -- for tools operating on an
// existing resource (delete, rename, edit, get_*_info), called before the
// name reaches path.join. Without this a name like "../../etc" walks
// straight out of the project directory.
const MAX_RESOURCE_NAME_LENGTH = 100;

// Project names are looser than resource names (GameMaker allows spaces and
// hyphens in them), but they still become a filename -- so path separators,
// "..", and other filesystem-meaningful characters stay out. Without this,
// a name like "../evil" writes a .yyp outside the project directory.
export function assertSafeProjectName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error("Project name cannot be empty");
  }
  if (name.length > MAX_RESOURCE_NAME_LENGTH) {
    throw new Error(`Project name is ${name.length} characters -- longer than the ${MAX_RESOURCE_NAME_LENGTH}-character limit`);
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_ -]*$/.test(name) || name.endsWith(" ")) {
    throw new Error(`Invalid project name "${name}": use letters, digits, underscores, hyphens, and spaces (must not start with a space or hyphen, or end with a space)`);
  }
}

export function assertSafeResourceName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error("Resource name cannot be empty");
  }
  if (name.length > MAX_RESOURCE_NAME_LENGTH) {
    throw new Error(`Resource name "${name.slice(0, 40)}..." is ${name.length} characters -- longer than the ${MAX_RESOURCE_NAME_LENGTH}-character limit`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid resource name "${name}": must start with a letter or underscore and contain only letters, digits, and underscores`
    );
  }
}

// GameMaker resource names are identifiers (referenceable in GML) and must
// be unique across every resource type, not just within one -- a script and
// an object can't share a name.
export function validateResourceName(yyp: Yyp, name: string): void {
  assertSafeResourceName(name);
  const lowerName = name.toLowerCase();
  const collision = yyp.resources.some((r: any) => r.id?.name?.toLowerCase() === lowerName);
  if (collision) {
    throw new Error(`A resource named "${name}" already exists in this project (names must be unique across all resource types)`);
  }
}

// Adds to yyp.resources if not already present. Shared by every writer.
export function registerResource(yyp: Yyp, name: string, resourcePath: string): void {
  const alreadyRegistered = yyp.resources.some((r: any) => r.id?.path === resourcePath);
  if (!alreadyRegistered) {
    yyp.resources.push({ id: { name, path: resourcePath } } as any);
  }
}

// GameMaker's IDE creates top-level asset folders (Rooms, Scripts, ...)
// lazily, so a project with no assets of a type yet may have no entry at
// all -- register one before anything can parent to it.
export function ensureFolder(yyp: Yyp, name: string): void {
  const folderPath = `folders/${name}.yy`;
  const folders = ((yyp as any).Folders ?? []) as any[];
  const exists = folders.some((f: any) => f.folderPath === folderPath);
  if (!exists) {
    folders.push({
      "$GMFolder": "",
      "%Name": name,
      folderPath,
      name,
      resourceType: "GMFolder",
      resourceVersion: RESOURCE_VERSIONS.folder
    });
    (yyp as any).Folders = folders;
  }
}

// Every GameMaker-created project has "audiogroup_default" registered by
// default, but a truly bare scaffold might not -- a sound referencing a
// missing entry fails to load.
export function ensureAudioGroup(yyp: Yyp, name: string = "audiogroup_default"): void {
  const groups = ((yyp as any).AudioGroups ?? []) as any[];
  const exists = groups.some((g: any) => g.name === name);
  if (!exists) {
    groups.push({
      "$GMAudioGroup": "v1",
      "%Name": name,
      exportDir: "",
      name,
      resourceType: "GMAudioGroup",
      resourceVersion: RESOURCE_VERSIONS.audioGroup,
      targets: BigInt(-1)
    });
    (yyp as any).AudioGroups = groups;
  }
}

/**
 * Ensure the "Default" entry is registered in the project's TextureGroups
 * list -- same reasoning as ensureAudioGroup, just for sprites/fonts
 * referencing texturegroups/Default.
 */
export function ensureTextureGroup(yyp: Yyp, name: string = "Default"): void {
  const groups = ((yyp as any).TextureGroups ?? []) as any[];
  const exists = groups.some((g: any) => g.name === name);
  if (!exists) {
    groups.push({
      isScaled: true,
      autocrop: true,
      border: 2,
      mipsToGenerate: 0,
      groupParent: null,
      targets: BigInt(-1),
      resourceVersion: RESOURCE_VERSIONS.textureGroup,
      name,
      resourceType: "GMTextureGroup",
      customOptions: "",
      compressFormat: "bz2",
      loadType: "default",
      directory: ""
    });
    (yyp as any).TextureGroups = groups;
  }
}

/**
 * Explicitly create a new, additional texture group (e.g. to keep a large
 * batch of sprites on their own texture page). Unlike ensureTextureGroup
 * (which silently no-ops if the group already exists, since it's only
 * auto-provisioning a prerequisite), this throws on a name collision --
 * the caller asked to create something, so silently doing nothing would be
 * misleading.
 */
export function addTextureGroup(yyp: Yyp, name: string): void {
  assertSafeResourceName(name);
  const groups = ((yyp as any).TextureGroups ?? []) as any[];
  if (groups.some((g: any) => g.name === name)) {
    throw new Error(`A texture group named "${name}" already exists`);
  }
  ensureTextureGroup(yyp, name);
}

/**
 * Explicitly create a new, additional audio group (e.g. to stream a large
 * music library separately from small sound effects). Same collision
 * behavior as addTextureGroup.
 */
export function addAudioGroup(yyp: Yyp, name: string): void {
  assertSafeResourceName(name);
  const groups = ((yyp as any).AudioGroups ?? []) as any[];
  if (groups.some((g: any) => g.name === name)) {
    throw new Error(`An audio group named "${name}" already exists`);
  }
  ensureAudioGroup(yyp, name);
}

