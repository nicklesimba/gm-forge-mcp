import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, ensureTextureGroup, validateResourceName, RESOURCE_VERSIONS, registerResource, parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

export interface TilesetOptions {
  tilehsep?: number;
  tilevsep?: number;
  tilexoff?: number;
  tileyoff?: number;
}

// GameMaker's own internal tile-page border padding, captured from a real
// GameMaker-authored tileset -- unrelated to any user input, so there's
// nothing to compute here.
const TILE_BORDER = 2;

interface TilesetFiles {
  dir: string;
  yyFile: string;
  catalogPath: string;
}

function tilesetFiles(projectDir: string, name: string): TilesetFiles {
  const dir = path.join(projectDir, "tilesets", name);
  return { dir, yyFile: path.join(dir, `${name}.yy`), catalogPath: `tilesets/${name}/${name}.yy` };
}

async function readSpriteDimensions(projectDir: string, spriteName: string): Promise<{ width: number; height: number }> {
  const spriteYyPath = path.join(projectDir, "sprites", spriteName, `${spriteName}.yy`);
  let sprite: any;
  try {
    sprite = parseGameMakerJson(await fs.readFile(spriteYyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Sprite "${spriteName}" does not exist (expected ${spriteYyPath}) -- add_tileset needs an existing sprite as its source image, add one first with add_sprite_from_images`);
    }
    throw new Error(`Failed to read sprite "${spriteName}" at ${spriteYyPath}: ${e.message}`);
  }
  return { width: sprite.width, height: sprite.height };
}

// How many whole tiles fit across/down the source sprite, given its real
// dimensions -- matches how GameMaker itself derives this from the sprite
// rather than trusting a caller-supplied count that could drift from reality.
function tileGrid(spriteSize: { width: number; height: number }, tileWidth: number, tileHeight: number, tilehsep: number, tilevsep: number, tilexoff: number, tileyoff: number) {
  const columns = Math.max(1, Math.floor((spriteSize.width - tilexoff + tilehsep) / (tileWidth + tilehsep)));
  const rows = Math.max(1, Math.floor((spriteSize.height - tileyoff + tilevsep) / (tileHeight + tilevsep)));
  return { columns, rows };
}

function newTilesetYy(
  name: string,
  spriteName: string,
  spriteSize: { width: number; height: number },
  tileWidth: number,
  tileHeight: number,
  options: TilesetOptions
) {
  const tilehsep = options.tilehsep ?? 0;
  const tilevsep = options.tilevsep ?? 0;
  const tilexoff = options.tilexoff ?? 0;
  const tileyoff = options.tileyoff ?? 0;
  const { columns, rows } = tileGrid(spriteSize, tileWidth, tileHeight, tilehsep, tilevsep, tilexoff, tileyoff);

  return {
    name,
    autoTileSets: [],
    macroPageTiles: { SerialiseHeight: 0, SerialiseWidth: 0, TileSerialiseData: [] },
    out_columns: columns,
    out_tilehborder: TILE_BORDER,
    out_tilevborder: TILE_BORDER,
    parent: { name: "Tilesets", path: "folders/Tilesets.yy" },
    spriteId: { name: spriteName, path: `sprites/${spriteName}/${spriteName}.yy` },
    spriteNoExport: true,
    textureGroupId: { name: "Default", path: "texturegroups/Default" },
    tileAnimationFrames: [],
    tileAnimationSpeed: 15.0,
    tileHeight,
    tilehsep,
    tilevsep,
    tileWidth,
    tilexoff,
    tileyoff,
    tile_count: columns * rows,
    resourceType: "GMTileSet",
    resourceVersion: RESOURCE_VERSIONS.tileset,
    "$GMTileSet": "v1",
    "%Name": name
  };
}

/**
 * Add a new tile set built from an existing sprite. tileWidth/tileHeight are
 * a design choice (the pixel size of one tile), so they're required rather
 * than guessed; everything derivable from the sprite (column/row/tile
 * counts) is computed from its real, already-registered dimensions.
 */
export async function addTileset(
  projectDir: string,
  yyp: Yyp,
  name: string,
  spriteName: string,
  tileWidth: number,
  tileHeight: number,
  options: TilesetOptions = {}
): Promise<Yyp> {
  validateResourceName(yyp, name);
  assertSafeResourceName(spriteName);
  const spriteSize = await readSpriteDimensions(projectDir, spriteName);

  const files = tilesetFiles(projectDir, name);
  await fs.mkdir(files.dir, { recursive: true });
  await fs.writeFile(
    files.yyFile,
    JSON.stringify(newTilesetYy(name, spriteName, spriteSize, tileWidth, tileHeight, options), null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Tilesets");
  ensureTextureGroup(yyp);
  registerResource(yyp, name, files.catalogPath);

  return yyp;
}

export interface TilesetEditOptions {
  tileWidth?: number;
  tileHeight?: number;
  tilehsep?: number;
  tilevsep?: number;
  tilexoff?: number;
  tileyoff?: number;
}

/**
 * Edit an existing tileset's tile dimensions/spacing/offset. Recomputes
 * out_columns/tile_count from the source sprite's real dimensions, same as
 * addTileset, so they can't drift from reality after the edit.
 */
export async function editTileset(
  projectDir: string,
  tilesetName: string,
  options: TilesetEditOptions
): Promise<void> {
  assertSafeResourceName(tilesetName);
  const yyFile = tilesetFiles(projectDir, tilesetName).yyFile;
  let tileset: any;
  try {
    tileset = parseGameMakerJson(await fs.readFile(yyFile, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Tileset "${tilesetName}" does not exist (expected ${yyFile})`);
    }
    throw new Error(`Failed to read tileset "${tilesetName}" at ${yyFile}: ${e.message}`);
  }

  if (options.tileWidth !== undefined) tileset.tileWidth = options.tileWidth;
  if (options.tileHeight !== undefined) tileset.tileHeight = options.tileHeight;
  if (options.tilehsep !== undefined) tileset.tilehsep = options.tilehsep;
  if (options.tilevsep !== undefined) tileset.tilevsep = options.tilevsep;
  if (options.tilexoff !== undefined) tileset.tilexoff = options.tilexoff;
  if (options.tileyoff !== undefined) tileset.tileyoff = options.tileyoff;

  const spriteSize = await readSpriteDimensions(projectDir, tileset.spriteId.name);
  const { columns, rows } = tileGrid(spriteSize, tileset.tileWidth, tileset.tileHeight, tileset.tilehsep, tileset.tilevsep, tileset.tilexoff, tileset.tileyoff);
  tileset.out_columns = columns;
  tileset.tile_count = columns * rows;

  await fs.writeFile(yyFile, JSON.stringify(tileset, null, 2), "utf8");
}
