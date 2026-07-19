import { promises as fs } from "fs";
import path from "path";
import { parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

const EVENT_TYPE_NAMES: Record<number, string> = {
  0: "Create",
  1: "Destroy",
  2: "Alarm",
  3: "Step",
  4: "Collision",
  5: "Keyboard",
  6: "Mouse",
  7: "Other",
  8: "Draw",
  9: "KeyPress",
  10: "KeyRelease",
  11: "Trigger",
  12: "CleanUp",
  13: "Gesture",
};

async function readResourceYy(projectDir: string, category: string, name: string): Promise<any> {
  assertSafeResourceName(name);
  const yyPath = path.join(projectDir, category, name, `${name}.yy`);
  try {
    return parseGameMakerJson(await fs.readFile(yyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`${category.slice(0, -1)} "${name}" does not exist (expected ${yyPath})`);
    }
    throw new Error(`Failed to read ${category.slice(0, -1)} "${name}" at ${yyPath}: ${e.message}`);
  }
}

export async function getObjectInfo(projectDir: string, objectName: string) {
  const obj = await readResourceYy(projectDir, "objects", objectName);
  return {
    name: obj.name,
    sprite: obj.spriteId?.name ?? null,
    parent: obj.parentObjectId?.name ?? null,
    solid: obj.solid,
    visible: obj.visible,
    persistent: obj.persistent,
    physicsEnabled: obj.physicsObject,
    events: obj.eventList.map((e: any) => ({
      type: EVENT_TYPE_NAMES[e.eventType] ?? `Unknown(${e.eventType})`,
      eventType: e.eventType,
      eventNum: e.eventNum,
    })),
  };
}

export async function getRoomInfo(projectDir: string, roomName: string) {
  const room = await readResourceYy(projectDir, "rooms", roomName);
  const instanceLayers = room.layers.filter((l: any) => l.resourceType === "GMRInstanceLayer");
  const instances = instanceLayers.flatMap((l: any) => l.instances).map((i: any) => ({
    name: i.name,
    object: i.objectId?.name,
    x: i.x,
    y: i.y,
    rotation: i.rotation,
  }));
  return {
    name: room.name,
    width: room.roomSettings.Width,
    height: room.roomSettings.Height,
    persistent: room.roomSettings.persistent,
    hasCreationCode: !!room.creationCodeFile,
    layers: room.layers.map((l: any) => ({ name: l.name, type: l.resourceType })),
    instances,
    instanceCount: instances.length,
  };
}

export async function getSpriteInfo(projectDir: string, spriteName: string) {
  const sprite = await readResourceYy(projectDir, "sprites", spriteName);
  return {
    name: sprite.name,
    width: sprite.width,
    height: sprite.height,
    frameCount: sprite.frames.length,
    origin: { x: sprite.sequence?.xorigin ?? 0, y: sprite.sequence?.yorigin ?? 0 },
    collisionKind: sprite.collisionKind,
    bbox: { left: sprite.bbox_left, top: sprite.bbox_top, right: sprite.bbox_right, bottom: sprite.bbox_bottom },
  };
}

export async function getShaderInfo(projectDir: string, shaderName: string) {
  const shader = await readResourceYy(projectDir, "shaders", shaderName);
  const dir = path.join(projectDir, "shaders", shaderName);
  const vertexCode = await fs.readFile(path.join(dir, `${shaderName}.vsh`), "utf8");
  const fragmentCode = await fs.readFile(path.join(dir, `${shaderName}.fsh`), "utf8");
  return { name: shader.name, type: shader.type, vertexCode, fragmentCode };
}

export async function getExtensionInfo(projectDir: string, extensionName: string) {
  const ext = await readResourceYy(projectDir, "extensions", extensionName);
  return {
    name: ext.name,
    extensionVersion: ext.extensionVersion,
    fileCount: (ext.files ?? []).length,
  };
}

export async function getParticleSystemInfo(projectDir: string, particleSystemName: string) {
  const ps = await readResourceYy(projectDir, "particles", particleSystemName);
  return {
    name: ps.name,
    emitterCount: (ps.emitters ?? []).length,
    emitterNames: (ps.emitters ?? []).map((e: any) => e.name),
  };
}

export async function getAnimCurveInfo(projectDir: string, animCurveName: string) {
  const curve = await readResourceYy(projectDir, "animcurves", animCurveName);
  return {
    name: curve.name,
    channelCount: (curve.channels ?? []).length,
    channelNames: (curve.channels ?? []).map((c: any) => c.name),
    pointCounts: (curve.channels ?? []).map((c: any) => (c.points ?? []).length),
  };
}

export async function getTilesetInfo(projectDir: string, tilesetName: string) {
  const tileset = await readResourceYy(projectDir, "tilesets", tilesetName);
  return {
    name: tileset.name,
    sprite: tileset.spriteId?.name ?? null,
    tileWidth: tileset.tileWidth,
    tileHeight: tileset.tileHeight,
    tileCount: tileset.tile_count,
    columns: tileset.out_columns,
  };
}

export async function getSoundInfo(projectDir: string, soundName: string) {
  const sound = await readResourceYy(projectDir, "sounds", soundName);
  return {
    name: sound.name,
    soundFile: sound.soundFile,
    volume: sound.volume,
    preload: sound.preload,
    sampleRate: sound.sampleRate,
    compression: sound.compression,
  };
}

export async function getFontInfo(projectDir: string, fontName: string) {
  const font = await readResourceYy(projectDir, "fonts", fontName);
  return {
    name: font.name,
    systemFontName: font.fontName,
    size: font.size,
    bold: font.bold,
    italic: font.italic,
    glyphCount: Object.keys(font.glyphs).length,
  };
}

export async function getNoteInfo(projectDir: string, noteName: string) {
  const note = await readResourceYy(projectDir, "notes", noteName);
  const contentPath = path.join(projectDir, "notes", noteName, `${noteName}.txt`);
  let content = "";
  try {
    content = await fs.readFile(contentPath, "utf8");
  } catch {
    // content file may not exist if built externally
  }
  return { name: note.name, content };
}

export async function getScriptInfo(projectDir: string, scriptName: string) {
  assertSafeResourceName(scriptName);
  const gmlPath = path.join(projectDir, "scripts", scriptName, `${scriptName}.gml`);
  let code: string;
  try {
    code = await fs.readFile(gmlPath, "utf8");
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Script "${scriptName}" does not exist (expected ${gmlPath})`);
    }
    throw new Error(`Failed to read script "${scriptName}" at ${gmlPath}: ${e.message}`);
  }
  return { name: scriptName, code, lineCount: code.split("\n").length };
}
