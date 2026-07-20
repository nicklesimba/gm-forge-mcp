import { promises as fs } from "fs";
import path from "path";
import { parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

// GameMaker's own "no tile here" sentinel. Verified against real GameMaker
// data (see decompressTileData).
export const EMPTY_TILE = -2147483648;

/**
 * Decode GameMaker's run-length-compressed room tile data (TileCompressedData)
 * into a flat array of tile values. @bscotch/yy (the library the rest of this
 * project is built on) declares this field `unknown` -- it isn't documented
 * anywhere official. This scheme was reverse-engineered from independent
 * community implementations and then verified against a real GameMaker room's
 * actual compressed array: decoding it produced exactly SerialiseWidth *
 * SerialiseHeight values, byte for byte.
 *
 * Encoding: a positive N means the next N values in the stream are literal
 * tiles, copied as-is; a negative N means "repeat the next single value N
 * times" (an RLE run).
 */
export function decompressTileData(data: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const n = data[i++];
    if (n < 0) {
      const v = data[i++];
      for (let k = 0; k < -n; k++) out.push(v);
    } else {
      for (let k = 0; k < n; k++) out.push(data[i++]);
    }
  }
  return out;
}

export interface TileLayerInfo {
  layerName: string;
  tilesetName: string | null;
  x: number;
  y: number;
  tileWidth: number;
  tileHeight: number;
  width: number; // grid columns
  height: number; // grid rows
  grid: number[][]; // [row][col]
}

// A tile layer's own gridX/gridY is only an editor-grid snap setting -- NOT
// necessarily the real tile size. The real pitch comes from the referenced
// tileset's own tileWidth/tileHeight (learned the hard way while placing a
// door: a room used gridX=32 for its snap grid while its tileset's real tiles
// were 16x16). Only fall back to gridX/gridY when there's no tileset to ask.
async function readTilesetTileSize(
  projectDir: string,
  tilesetName: string
): Promise<{ tileWidth: number; tileHeight: number } | null> {
  assertSafeResourceName(tilesetName);
  const yyPath = path.join(projectDir, "tilesets", tilesetName, `${tilesetName}.yy`);
  try {
    const tileset = parseGameMakerJson(await fs.readFile(yyPath, "utf8"));
    return { tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight };
  } catch {
    return null;
  }
}

/**
 * Read and decode every tile layer (GMRTileLayer) in a room, including ones
 * nested inside folder-like layers. Returns each layer's tile grid in real
 * world coordinates, ready to query.
 */
export async function getRoomTileLayers(projectDir: string, roomName: string): Promise<TileLayerInfo[]> {
  assertSafeResourceName(roomName);
  const roomYyPath = path.join(projectDir, "rooms", roomName, `${roomName}.yy`);
  let room: any;
  try {
    room = parseGameMakerJson(await fs.readFile(roomYyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Room "${roomName}" does not exist (expected ${roomYyPath})`);
    }
    throw new Error(`Failed to read room "${roomName}" at ${roomYyPath}: ${e.message}`);
  }

  const results: TileLayerInfo[] = [];

  async function walk(layers: any[]): Promise<void> {
    for (const layer of layers ?? []) {
      if (layer.resourceType === "GMRTileLayer" && layer.tiles) {
        const tilesetName: string | null = layer.tilesetId?.name ?? null;
        const size = tilesetName ? await readTilesetTileSize(projectDir, tilesetName) : null;
        const tileWidth = size?.tileWidth ?? layer.gridX ?? 32;
        const tileHeight = size?.tileHeight ?? layer.gridY ?? 32;
        const width: number = layer.tiles.SerialiseWidth;
        const height: number = layer.tiles.SerialiseHeight;
        const flat = decompressTileData(layer.tiles.TileCompressedData ?? []);
        const grid: number[][] = [];
        for (let r = 0; r < height; r++) grid.push(flat.slice(r * width, (r + 1) * width));
        results.push({
          layerName: layer.name ?? layer["%Name"],
          tilesetName,
          x: layer.x ?? 0,
          y: layer.y ?? 0,
          tileWidth,
          tileHeight,
          width,
          height,
          grid,
        });
      }
      if (Array.isArray(layer.layers) && layer.layers.length > 0) {
        await walk(layer.layers);
      }
    }
  }

  await walk(room.layers ?? []);
  return results;
}

export interface TileRegionResult {
  layerName: string;
  tilesetName: string | null;
  occupied: boolean;
  tileValue?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  tileCount?: number;
}

// Cap on flood-fill size -- a sane guard against a pathologically huge fully-
// solid layer, not something expected to trigger on real rooms (Convoy's
// largest room's entire tile grid is ~27,000 cells).
const MAX_FLOOD_FILL_CELLS = 500_000;

/**
 * For each tile layer, check whether the given world point sits on a real
 * (non-empty) tile, and if so, flood-fill the connected region of non-empty
 * tiles it belongs to and report that region's bounding box. This is what
 * answers "is this spot actually inside the building, and how far does the
 * building extend" -- the exact question static instance data can't answer,
 * since decorative/collision geometry drawn via tiles is invisible to
 * get_room_info.
 */
export function findTileRegion(layers: TileLayerInfo[], worldX: number, worldY: number): TileRegionResult[] {
  return layers.map(layer => {
    const col = Math.floor((worldX - layer.x) / layer.tileWidth);
    const row = Math.floor((worldY - layer.y) / layer.tileHeight);
    if (row < 0 || row >= layer.height || col < 0 || col >= layer.width || layer.grid[row][col] === EMPTY_TILE) {
      return { layerName: layer.layerName, tilesetName: layer.tilesetName, occupied: false };
    }

    const visited = new Set<number>();
    const key = (r: number, c: number) => r * layer.width + c;
    const queue: [number, number][] = [[row, col]];
    visited.add(key(row, col));
    let minR = row, maxR = row, minC = col, maxC = col;
    let count = 0;
    while (queue.length > 0 && count < MAX_FLOOD_FILL_CELLS) {
      const [r, c] = queue.pop()!;
      count++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= layer.height || nc < 0 || nc >= layer.width) continue;
        if (layer.grid[nr][nc] === EMPTY_TILE) continue;
        const k = key(nr, nc);
        if (visited.has(k)) continue;
        visited.add(k);
        queue.push([nr, nc]);
      }
    }

    return {
      layerName: layer.layerName,
      tilesetName: layer.tilesetName,
      occupied: true,
      tileValue: layer.grid[row][col],
      bbox: {
        x0: layer.x + minC * layer.tileWidth,
        y0: layer.y + minR * layer.tileHeight,
        x1: layer.x + (maxC + 1) * layer.tileWidth,
        y1: layer.y + (maxR + 1) * layer.tileHeight,
      },
      tileCount: count,
    };
  });
}
