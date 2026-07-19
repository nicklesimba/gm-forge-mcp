import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, ensureTextureGroup, registerResource, validateResourceName, RESOURCE_VERSIONS, parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

interface ImageSize {
  width: number;
  height: number;
}

// Reads just the IHDR chunk of a PNG (signature + 8 bytes of header) to get
// real dimensions -- avoids pulling in an image library for one field.
export async function readPngDimensions(pngPath: string): Promise<ImageSize> {
  const handle = await fs.open(pngPath, "r");
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    const signatureOk = header.readUInt32BE(0) === 0x89504e47 && header.readUInt32BE(4) === 0x0d0a1a0a;
    if (!signatureOk) {
      throw new Error(`Not a valid PNG file: ${pngPath}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

async function listFrameSources(framesDir: string): Promise<string[]> {
  const pngs = (await fs.readdir(framesDir))
    .filter(f => f.toLowerCase().endsWith(".png"))
    .sort();
  if (pngs.length === 0) {
    throw new Error(`No PNG frames found in ${framesDir}`);
  }
  return pngs;
}

interface ImportedFrames {
  frameIds: string[];
  size: ImageSize;
}

/**
 * Copies each source PNG into the sprite directory twice: once as the flat
 * composite (what GameMaker renders) and once under layers/<frameId>/ (what
 * the sprite editor loads for non-destructive layer editing). GameMaker
 * refuses to load the project without the second copy, even though it
 * duplicates the first.
 */
async function importFrames(framesDir: string, files: string[], spriteDir: string, layerId: string): Promise<ImportedFrames> {
  const frameIds: string[] = [];
  let size: ImageSize | null = null;

  for (const file of files) {
    const source = path.join(framesDir, file);
    const dims = await readPngDimensions(source);
    if (!size) {
      size = dims;
    } else if (dims.width !== size.width || dims.height !== size.height) {
      throw new Error(`Frame ${file} is ${dims.width}x${dims.height}, expected ${size.width}x${size.height} (all frames must match the first frame's size)`);
    }

    const frameId = crypto.randomUUID();
    frameIds.push(frameId);

    await fs.copyFile(source, path.join(spriteDir, `${frameId}.png`));

    const layerDir = path.join(spriteDir, "layers", frameId);
    await fs.mkdir(layerDir, { recursive: true });
    await fs.copyFile(source, path.join(layerDir, `${layerId}.png`));
  }

  return { frameIds, size: size! };
}

function frameEntry(frameId: string) {
  return {
    name: frameId,
    resourceType: "GMSpriteFrame",
    resourceVersion: RESOURCE_VERSIONS.spriteFrame,
    "$GMSpriteFrame": "v1",
    "%Name": frameId
  };
}

function layerEntry(layerId: string) {
  return {
    visible: true,
    isLocked: false,
    blendMode: 0,
    opacity: 100.0,
    displayName: "default",
    name: layerId,
    resourceType: "GMImageLayer",
    resourceVersion: RESOURCE_VERSIONS.spriteLayer,
    "$GMImageLayer": "",
    "%Name": layerId
  };
}

function frameKeyframe(spriteName: string, frameId: string, index: number) {
  return {
    id: crypto.randomUUID(),
    Key: index,
    Length: 1.0,
    Stretch: false,
    Disabled: false,
    IsCreationKey: false,
    Channels: {
      "0": {
        Id: { name: frameId, path: `sprites/${spriteName}/${spriteName}.yy` },
        resourceType: "SpriteFrameKeyframe",
        resourceVersion: RESOURCE_VERSIONS.spriteFrameKeyframe,
        "$SpriteFrameKeyframe": ""
      }
    },
    resourceType: "Keyframe<SpriteFrameKeyframe>",
    resourceVersion: RESOURCE_VERSIONS.spriteFrameKeyframe,
    "$Keyframe<SpriteFrameKeyframe>": ""
  };
}

function sequenceEntry(spriteName: string, frameIds: string[]) {
  const keyframes = frameIds.map((id, i) => frameKeyframe(spriteName, id, i));
  const framesTrack = {
    name: "frames",
    spriteId: null,
    keyframes: {
      Keyframes: keyframes,
      resourceType: "KeyframeStore<SpriteFrameKeyframe>",
      resourceVersion: RESOURCE_VERSIONS.spriteFrameKeyframe,
      "$KeyframeStore<SpriteFrameKeyframe>": ""
    },
    trackColour: 0,
    inheritsTrackColour: true,
    builtinName: 0,
    traits: 0,
    interpolation: 1,
    tracks: [],
    events: [],
    modifiers: [],
    isCreationTrack: false,
    resourceType: "GMSpriteFramesTrack",
    resourceVersion: RESOURCE_VERSIONS.spriteFramesTrack,
    "$GMSpriteFramesTrack": ""
  };

  return {
    name: spriteName,
    length: frameIds.length,
    playback: 1,
    playbackSpeed: 30.0,
    playbackSpeedType: 0,
    autoRecord: true,
    volume: 1.0,
    lockOrigin: false,
    showBackdrop: true,
    showBackdropImage: false,
    backdropImagePath: "",
    backdropImageOpacity: 0.5,
    backdropWidth: 1366,
    backdropHeight: 768,
    backdropXOffset: 0.0,
    backdropYOffset: 0.0,
    xorigin: 0,
    yorigin: 0,
    eventToFunction: {},
    eventStubScript: null,
    visibleRange: null,
    timeUnits: 1,
    tracks: [framesTrack],
    moments: {
      Keyframes: [],
      resourceType: "KeyframeStore<MomentsEventKeyframe>",
      resourceVersion: RESOURCE_VERSIONS.spriteMomentsKeyframes,
      "$KeyframeStore<MomentsEventKeyframe>": ""
    },
    events: {
      Keyframes: [],
      resourceType: "KeyframeStore<MessageEventKeyframe>",
      resourceVersion: RESOURCE_VERSIONS.spriteMessageKeyframes,
      "$KeyframeStore<MessageEventKeyframe>": ""
    },
    resourceType: "GMSequence",
    resourceVersion: RESOURCE_VERSIONS.spriteSequence,
    "$GMSequence": "v1",
    "%Name": spriteName
  };
}

function spriteYy(name: string, size: ImageSize, frameIds: string[], layerId: string) {
  return {
    name,
    type: 0,
    origin: 0,
    preMultiplyAlpha: false,
    edgeFiltering: false,
    collisionKind: 0,
    collisionTolerance: 0,
    DynamicTexturePage: false,
    For3D: false,
    HTile: false,
    VTile: false,
    width: size.width,
    height: size.height,
    bboxMode: 0,
    bbox_left: 0,
    bbox_top: 0,
    bbox_right: size.width - 1,
    bbox_bottom: size.height - 1,
    gridX: 0,
    gridY: 0,
    swfPrecision: 0.5,
    nineSlice: null,
    swatchColours: null,
    textureGroupId: { name: "Default", path: "texturegroups/Default" },
    frames: frameIds.map(frameEntry),
    layers: [layerEntry(layerId)],
    sequence: sequenceEntry(name, frameIds),
    parent: { name: "Sprites", path: "folders/Sprites.yy" },
    resourceType: "GMSprite",
    resourceVersion: RESOURCE_VERSIONS.sprite,
    "$GMSprite": "v2",
    "%Name": name
  };
}

export async function addSpriteFromImages(projectDir: string, yyp: Yyp, name: string, framesDir: string): Promise<Yyp> {
  validateResourceName(yyp, name);

  const spriteDir = path.join(projectDir, "sprites", name);
  await fs.mkdir(spriteDir, { recursive: true });

  const sources = await listFrameSources(framesDir);
  const layerId = crypto.randomUUID();
  const { frameIds, size } = await importFrames(framesDir, sources, spriteDir, layerId);

  await fs.writeFile(
    path.join(spriteDir, `${name}.yy`),
    JSON.stringify(spriteYy(name, size, frameIds, layerId), null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Sprites");
  ensureTextureGroup(yyp);
  registerResource(yyp, name, `sprites/${name}/${name}.yy`);

  return yyp;
}

export interface SpriteEditOptions {
  xorigin?: number;
  yorigin?: number;
  collisionKind?: number;
  bboxMode?: number;
  bbox_left?: number;
  bbox_top?: number;
  bbox_right?: number;
  bbox_bottom?: number;
}

/**
 * Edit an existing sprite's origin, collision kind, and/or bounding box --
 * not its frame data, which is a bigger concern closer to delete+recreate
 * than an in-place edit. Setting xorigin/yorigin also flips the top-level
 * origin preset to 9 (Custom), matching what the IDE does when you type a
 * coordinate instead of picking a preset from the dropdown.
 */
export async function editSprite(
  projectDir: string,
  name: string,
  options: SpriteEditOptions
): Promise<void> {
  assertSafeResourceName(name);
  const yyPath = path.join(projectDir, "sprites", name, `${name}.yy`);
  let sprite: any;
  try {
    sprite = parseGameMakerJson(await fs.readFile(yyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Sprite "${name}" does not exist (expected ${yyPath})`);
    }
    throw new Error(`Failed to read sprite "${name}" at ${yyPath}: ${e.message}`);
  }

  if (options.xorigin !== undefined || options.yorigin !== undefined) {
    if (options.xorigin !== undefined) sprite.sequence.xorigin = options.xorigin;
    if (options.yorigin !== undefined) sprite.sequence.yorigin = options.yorigin;
    sprite.origin = 9; // Custom
  }
  if (options.collisionKind !== undefined) sprite.collisionKind = options.collisionKind;
  if (options.bboxMode !== undefined) sprite.bboxMode = options.bboxMode;
  if (options.bbox_left !== undefined) sprite.bbox_left = options.bbox_left;
  if (options.bbox_top !== undefined) sprite.bbox_top = options.bbox_top;
  if (options.bbox_right !== undefined) sprite.bbox_right = options.bbox_right;
  if (options.bbox_bottom !== undefined) sprite.bbox_bottom = options.bbox_bottom;

  await fs.writeFile(yyPath, JSON.stringify(sprite, null, 2), "utf8");
}
