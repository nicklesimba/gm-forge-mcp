import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, ensureTextureGroup, validateResourceName, RESOURCE_VERSIONS, registerResource, parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

const execFileAsync = promisify(execFile);

export interface FontOptions {
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

function fontStyleName(bold: boolean, italic: boolean): string {
  return bold && italic ? "Bold Italic" : bold ? "Bold" : italic ? "Italic" : "Regular";
}

const FONT_REGISTRY_HIVES = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"
];

// Windows registers each installed font as a value like "Arial (TrueType)";
// family name is everything before the "(...)". Style variants (Bold,
// Italic) usually register as separate families sharing the base name as a
// prefix, hence the prefix match below. Returns null, not an empty set, if
// the registry couldn't be read -- "no fonts found" and "couldn't check"
// need to stay distinguishable.
async function listInstalledFontFamilies(): Promise<Set<string> | null> {
  // "reg query" is Windows-only; on Mac/Linux this would fail with ENOENT
  // per hive anyway (caught below), but checking the platform up front
  // avoids spawning a process we already know can't exist.
  if (process.platform !== "win32") return null;

  const families = new Set<string>();
  let anyHiveReadable = false;
  for (const hive of FONT_REGISTRY_HIVES) {
    try {
      const { stdout } = await execFileAsync("reg", ["query", hive]);
      anyHiveReadable = true;
      for (const line of stdout.split("\n")) {
        const match = line.match(/^ {4}(.+?)\s+\((?:TrueType|OpenType|Raster|Type 1)\)\s+REG_SZ/);
        if (match) families.add(match[1].trim());
      }
    } catch {
      // this hive unreadable -- the other one may still work
    }
  }
  return anyHiveReadable ? families : null;
}

// A missing font isn't a crash risk like a bad sound/sprite file -- GameMaker
// just falls back to a default -- so this warns rather than throws. Null
// means the check itself couldn't run (registry unreadable), not that the
// font is fine.
export async function checkSystemFontInstalled(systemFontName: string): Promise<string | null> {
  const families = await listInstalledFontFamilies();
  if (families === null) return null;
  const target = systemFontName.toLowerCase();
  const found = [...families].some(f => f.toLowerCase() === target || f.toLowerCase().startsWith(`${target} `));
  return found ? null : `"${systemFontName}" doesn't match any font installed on this machine -- GameMaker will silently fall back to a default font rather than fail, but the visual result won't be what was intended. Check the exact family name (Windows Settings > Fonts).`;
}

/**
 * Add a new font referencing an installed system font by name (not a bundled
 * TTF). regenerateBitmap is set true so GameMaker recomputes its own glyph
 * bitmap and metrics on load rather than trusting empty placeholder glyph
 * data.
 */
export async function addFont(
  projectDir: string,
  yyp: Yyp,
  fontName: string,
  systemFontName: string,
  options: FontOptions = {}
): Promise<{ yyp: Yyp; warning: string | null }> {
  validateResourceName(yyp, fontName);
  const warning = await checkSystemFontInstalled(systemFontName);

  const dir = path.join(projectDir, "fonts", fontName);
  await fs.mkdir(dir, { recursive: true });

  const size = options.size ?? 12;
  const styleName = fontStyleName(options.bold ?? false, options.italic ?? false);

  const fontYy = {
    "$GMFont": "",
    "%Name": fontName,
    AntiAlias: 1,
    applyKerning: 0,
    ascender: 0,
    ascenderOffset: 0,
    bold: options.bold ?? false,
    canGenerateBitmap: true,
    charset: 0,
    first: 0,
    fontName: systemFontName,
    glyphOperations: 0,
    glyphs: {},
    hinting: 0,
    includeTTF: false,
    interpreter: 0,
    italic: options.italic ?? false,
    kerningPairs: [],
    last: 0,
    lineHeight: 0,
    maintainGms1Font: false,
    name: fontName,
    parent: {
      name: "Fonts",
      path: "folders/Fonts.yy"
    },
    pointRounding: 0,
    ranges: [{ lower: 32, upper: 127 }],
    regenerateBitmap: true,
    resourceType: "GMFont",
    resourceVersion: RESOURCE_VERSIONS.font,
    sampleText: "abcdef ABCDEF\n0123456789 .,<!?",
    sdfSpread: 8,
    size,
    styleName,
    textureGroupId: {
      name: "Default",
      path: "texturegroups/Default"
    },
    TTFName: "",
    usesSDF: false
  };

  await fs.writeFile(
    path.join(dir, `${fontName}.yy`),
    JSON.stringify(fontYy, null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Fonts");
  ensureTextureGroup(yyp);

  registerResource(yyp, fontName, `fonts/${fontName}/${fontName}.yy`);

  return { yyp, warning };
}

export interface FontEditOptions {
  systemFontName?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Edit an existing font's system font name, size, or style. Re-checks the
 * system font when systemFontName changes, same warning-not-throw behavior
 * as addFont.
 */
export async function editFont(
  projectDir: string,
  fontName: string,
  options: FontEditOptions
): Promise<{ warning: string | null }> {
  assertSafeResourceName(fontName);
  const yyPath = path.join(projectDir, "fonts", fontName, `${fontName}.yy`);
  let font: any;
  try {
    font = parseGameMakerJson(await fs.readFile(yyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Font "${fontName}" does not exist (expected ${yyPath})`);
    }
    throw new Error(`Failed to read font "${fontName}" at ${yyPath}: ${e.message}`);
  }

  let warning: string | null = null;
  if (options.systemFontName !== undefined) {
    warning = await checkSystemFontInstalled(options.systemFontName);
    font.fontName = options.systemFontName;
  }
  if (options.size !== undefined) font.size = options.size;
  if (options.bold !== undefined) font.bold = options.bold;
  if (options.italic !== undefined) font.italic = options.italic;
  if (options.bold !== undefined || options.italic !== undefined) {
    font.styleName = fontStyleName(font.bold, font.italic);
  }

  await fs.writeFile(yyPath, JSON.stringify(font, null, 2), "utf8");
  return { warning };
}
