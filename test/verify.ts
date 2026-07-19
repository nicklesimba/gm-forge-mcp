// Regression suite for the resource writers. Expected key-sets below came
// from real, GameMaker-authored files that load cleanly in the actual IDE.
// If GameMaker's file format changes, refresh these from a real project
// export rather than editing them to make a test pass.
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { loadYyp, writeYyp, withProjectLock, addTextureGroup, addAudioGroup } from "../src/gm/yyp.js";
import { addRoom, editRoom, reorderRoom, moveRoomRelativeTo } from "../src/gm/rooms.js";
import { addScript, editScript } from "../src/gm/scripts.js";
import { addObject, addObjectEvent } from "../src/gm/objects.js";
import { addSpriteFromImages, editSprite } from "../src/gm/sprites.js";
import { addRoomInstance } from "../src/gm/instances.js";
import { addShader, editShader } from "../src/gm/shaders.js";
import { addSound, editSound } from "../src/gm/sounds.js";
import { addFont, editFont } from "../src/gm/fonts.js";
import { addTileset, editTileset } from "../src/gm/tilesets.js";
import { addExtension } from "../src/gm/extensions.js";
import { addParticleSystem } from "../src/gm/particle_systems.js";
import { addAnimCurve } from "../src/gm/animation_curves.js";
import { getObjectInfo, getRoomInfo, getSpriteInfo, getScriptInfo, getShaderInfo, getSoundInfo, getFontInfo, getNoteInfo, getTilesetInfo, getExtensionInfo, getParticleSystemInfo, getAnimCurveInfo } from "../src/gm/introspect.js";
import { findReferences } from "../src/gm/references.js";
import { deleteResource, ResourceInUseError } from "../src/gm/delete.js";
import { renameResource } from "../src/gm/rename.js";
import { lintProject } from "../src/gm/lint.js";
import { addNote } from "../src/gm/notes.js";
import { compileProject } from "../src/gm/build.js";
import { findProjectTool, findIgor } from "../src/gm/gamemaker-tools.js";

let passed = 0;
let failed = 0;
let skipped = 0;
const skippedReasons: string[] = [];

/**
 * Every skip here means one of the most authoritative checks (real
 * ProjectTool/Igor validation, not just our own structural assertions) did
 * NOT run on this machine. That's silent by default in most test runners --
 * "N passed, 0 failed" reads the same whether those ran or not -- so it gets
 * its own counter and its own line in the summary instead.
 */
function skip(label: string) {
  skipped++;
  skippedReasons.push(label);
  console.log(`SKIP: ${label}`);
}

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.log(`FAIL: ${label}${detail ? " -- " + detail : ""}`);
  }
}

async function expectThrows(label: string, fn: () => Promise<any>) {
  try {
    await fn();
    ok(label, false, "expected an error, none was thrown");
  } catch {
    ok(label, true);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function keysMatch(a: object, b: object): boolean {
  const ak = new Set(Object.keys(a));
  const bk = new Set(Object.keys(b));
  if (ak.size !== bk.size) return false;
  for (const k of ak) if (!bk.has(k)) return false;
  return true;
}

// Reference key-sets captured from real Convoy project files (2026-07-17)
const REF = {
  room: new Set(["$GMRoom", "%Name", "creationCodeFile", "inheritCode", "inheritCreationOrder",
    "inheritLayers", "instanceCreationOrder", "isDnd", "layers", "name", "parent", "parentRoom",
    "physicsSettings", "resourceType", "resourceVersion", "roomSettings", "sequenceId",
    "views", "viewSettings", "volume"]),
  roomInstanceLayer: new Set(["$GMRInstanceLayer", "%Name", "depth", "effectEnabled", "effectType",
    "gridX", "gridY", "hierarchyFrozen", "inheritLayerDepth", "inheritLayerSettings",
    "inheritSubLayers", "inheritVisibility", "instances", "layers", "name", "properties",
    "resourceType", "resourceVersion", "userdefinedDepth", "visible"]),
  roomInstance: new Set(["$GMRInstance", "%Name", "colour", "frozen", "hasCreationCode", "ignore",
    "imageIndex", "imageSpeed", "inheritCode", "inheritedItemId", "inheritItemSettings", "isDnd",
    "name", "objectId", "properties", "resourceType", "resourceVersion", "rotation", "scaleX",
    "scaleY", "x", "y"]),
  script: new Set(["$GMScript", "%Name", "resourceType", "resourceVersion", "name",
    "isCompatibility", "isDnD", "parent"]),
  object: new Set(["$GMObject", "%Name", "resourceType", "resourceVersion", "name", "spriteId",
    "solid", "visible", "managed", "spriteMaskId", "persistent", "parentObjectId",
    "physicsObject", "physicsSensor", "physicsShape", "physicsGroup", "physicsDensity",
    "physicsRestitution", "physicsLinearDamping", "physicsAngularDamping", "physicsFriction",
    "physicsStartAwake", "physicsKinematic", "physicsShapePoints", "eventList", "properties",
    "overriddenProperties", "parent"]),
  objectEvent: new Set(["$GMEvent", "%Name", "collisionObjectId", "eventNum", "eventType",
    "isDnD", "name", "resourceType", "resourceVersion"]),
  sprite: new Set(["$GMSprite", "%Name", "bboxMode", "bbox_bottom", "bbox_left", "bbox_right",
    "bbox_top", "collisionKind", "collisionTolerance", "DynamicTexturePage", "edgeFiltering",
    "For3D", "frames", "gridX", "gridY", "height", "HTile", "layers", "name", "nineSlice",
    "origin", "parent", "preMultiplyAlpha", "resourceType", "resourceVersion", "sequence",
    "swatchColours", "swfPrecision", "textureGroupId", "type", "VTile", "width"]),
  spriteFrame: new Set(["$GMSpriteFrame", "%Name", "name", "resourceType", "resourceVersion"]),
  spriteLayer: new Set(["$GMImageLayer", "%Name", "blendMode", "displayName", "isLocked", "name",
    "opacity", "resourceType", "resourceVersion", "visible"]),
  spriteSequence: new Set(["$GMSequence", "%Name", "autoRecord", "backdropHeight",
    "backdropImageOpacity", "backdropImagePath", "backdropWidth", "backdropXOffset",
    "backdropYOffset", "events", "eventStubScript", "eventToFunction", "length", "lockOrigin",
    "moments", "name", "playback", "playbackSpeed", "playbackSpeedType", "resourceType",
    "resourceVersion", "showBackdrop", "showBackdropImage", "timeUnits", "tracks",
    "visibleRange", "volume", "xorigin", "yorigin"]),
  shader: new Set(["$GMShader", "%Name", "name", "parent", "resourceType", "resourceVersion", "type"]),
  sound: new Set(["$GMSound", "%Name", "audioGroupId", "bitDepth", "channelFormat", "compression",
    "compressionQuality", "conversionMode", "duration", "exportDir", "name", "parent", "preload",
    "resourceType", "resourceVersion", "sampleRate", "soundFile", "volume"]),
  font: new Set(["$GMFont", "%Name", "AntiAlias", "applyKerning", "ascender", "ascenderOffset",
    "bold", "canGenerateBitmap", "charset", "first", "fontName", "glyphOperations", "glyphs",
    "hinting", "includeTTF", "interpreter", "italic", "kerningPairs", "last", "lineHeight",
    "maintainGms1Font", "name", "parent", "pointRounding", "ranges", "regenerateBitmap",
    "resourceType", "resourceVersion", "sampleText", "sdfSpread", "size", "styleName",
    "textureGroupId", "TTFName", "usesSDF"]),
  tileset: new Set(["$GMTileSet", "%Name", "autoTileSets", "macroPageTiles", "name", "out_columns",
    "out_tilehborder", "out_tilevborder", "parent", "resourceType", "resourceVersion", "spriteId",
    "spriteNoExport", "textureGroupId", "tileAnimationFrames", "tileAnimationSpeed", "tileHeight",
    "tilehsep", "tilevsep", "tileWidth", "tilexoff", "tileyoff", "tile_count"]),
  extension: new Set(["$GMExtension", "%Name", "androidactivityinject", "androidclassname",
    "androidcodeinjection", "androidinject", "androidmanifestinject", "androidPermissions",
    "androidProps", "androidsourcedir", "author", "classname", "copyToTargets", "description",
    "exportToGame", "extensionVersion", "files", "gradleinject", "hasConvertedCodeInjection",
    "helpfile", "HTML5CodeInjection", "html5Props", "IncludedResources", "installdir",
    "iosCocoaPodDependencies", "iosCocoaPods", "ioscodeinjection", "iosdelegatename",
    "iosplistinject", "iosProps", "iosSystemFrameworkEntries", "iosThirdPartyFrameworkEntries",
    "license", "maccompilerflags", "maclinkerflags", "macsourcedir", "name", "options",
    "optionsFile", "packageId", "parent", "productId", "resourceType", "resourceVersion",
    "sourcedir", "supportedTargets", "tvosclassname", "tvosCocoaPodDependencies", "tvosCocoaPods",
    "tvoscodeinjection", "tvosdelegatename", "tvosmaccompilerflags", "tvosmaclinkerflags",
    "tvosplistinject", "tvosProps", "tvosSystemFrameworkEntries", "tvosThirdPartyFrameworkEntries"]),
  particleSystem: new Set(["resourceType", "resourceVersion", "name", "backdropHeight",
    "backdropImageOpacity", "backdropImagePath", "backdropWidth", "backdropXOffset",
    "backdropYOffset", "drawOrder", "emitters", "parent", "showBackdrop", "showBackdropImage",
    "xorigin", "yorigin", "$GMParticleSystem", "%Name"]),
  particleEmitter: new Set(["$GMPSEmitter", "%Name", "resourceType", "resourceVersion", "name",
    "additiveBlend", "directionIncrease", "directionMax", "directionMin", "directionWiggle",
    "distribution", "editorColour", "editorDrawShape", "emitCount", "emitDelayMax",
    "emitDelayMin", "emitDelayUnits", "emitIntervalMax", "emitIntervalMin", "emitIntervalUnits",
    "enabled", "endColour", "GMPresetName", "gravityDirection", "gravityForce", "headPosition",
    "lifetimeMax", "lifetimeMin", "linkedEmitter", "locked", "midColour", "mode",
    "orientationIncrease", "orientationMax", "orientationMin", "orientationRelative",
    "orientationWiggle", "regionH", "regionW", "regionX", "regionY", "scaleX", "scaleY", "shape",
    "sizeIncrease", "sizeMax", "sizeMin", "sizeWiggle", "spawnOnDeathCount", "spawnOnDeathGMPreset",
    "spawnOnDeathId", "spawnOnUpdateCount", "spawnOnUpdateGMPreset", "spawnOnUpdateId",
    "speedIncrease", "speedMax", "speedMin", "speedWiggle", "spriteAnimate", "spriteId",
    "spriteRandom", "spriteStretch", "startColour", "texture"]),
  animCurve: new Set(["$GMAnimCurve", "%Name", "name", "channels", "function", "parent",
    "resourceType", "resourceVersion"]),
  animCurveChannel: new Set(["$GMAnimCurveChannel", "%Name", "name", "colour", "points",
    "resourceType", "resourceVersion", "visible"]),
};

function keysMatchRef(obj: object, ref: Set<string>): boolean {
  const keys = new Set(Object.keys(obj));
  if (keys.size !== ref.size) return false;
  for (const k of keys) if (!ref.has(k)) return false;
  return true;
}

async function makeBareProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gm-mcp-test-"));
  const yyp = {
    "$GMProject": "v1",
    "%Name": "TestProj",
    AudioGroups: [],
    Folders: [],
    configs: { name: "Default", children: [] },
    defaultScriptType: 0,
    ForcedPrefabProjectReferences: [],
    IncludedFiles: [],
    isEcma: false,
    LibraryEmitters: [],
    MetaData: { IDEVersion: "2024.14.4.222" },
    name: "TestProj",
    resources: [],
    resourceType: "GMProject",
    resourceVersion: "2.0",
    RoomOrderNodes: [],
    templateType: "game",
    TextureGroups: []
  };
  await fs.writeFile(path.join(dir, "TestProj.yyp"), JSON.stringify(yyp, null, 2), "utf8");
  return dir;
}

async function main() {
  const dir = await makeBareProject();

  // --- Room ---
  let yyp = await loadYyp(dir);
  yyp = await addRoom(dir, yyp, "rmTest", { width: 800, height: 600, persistent: false, creationCode: "show_debug_message(1);" });
  await writeYyp(dir, yyp);
  const room = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmTest/rmTest.yy"), "utf8"));
  ok("room: top-level keys match real GameMaker schema", keysMatchRef(room, REF.room));
  ok("room: Instances layer keys match", keysMatchRef(room.layers[0], REF.roomInstanceLayer));
  ok("room: width/height applied", room.roomSettings.Width === 800 && room.roomSettings.Height === 600);
  ok("room: Rooms folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Rooms.yy"));

  // Regression: a room with NO creation code must still have creationCodeFile
  // present (as "") -- GameMaker's own validator rejects it if the key is
  // missing entirely, a real bug caught by ProjectTool against a live
  // project, invisible until then because every other room-key test
  // happened to always pass creationCode.
  yyp = await addRoom(dir, yyp, "rmNoCreationCode", { width: 400, height: 300, persistent: false });
  await writeYyp(dir, yyp);
  const roomNoCode = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmNoCreationCode/rmNoCreationCode.yy"), "utf8"));
  ok("room (no creation code): still matches real GameMaker schema", keysMatchRef(roomNoCode, REF.room));
  ok("room (no creation code): creationCodeFile is empty string, not absent", roomNoCode.creationCodeFile === "");

  // --- Edit room ---
  await editRoom(dir, "rmTest", { width: 1024, height: 768, persistent: true });
  const editedRoom = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmTest/rmTest.yy"), "utf8"));
  ok("editRoom: width/height/persistent applied", editedRoom.roomSettings.Width === 1024
    && editedRoom.roomSettings.Height === 768 && editedRoom.roomSettings.persistent === true);
  ok("editRoom: views resized too", editedRoom.views[0].wview === 1024 && editedRoom.views[0].hview === 768);
  await expectThrows("editRoom: rejects nonexistent room", () => editRoom(dir, "rmDoesNotExist", { width: 100 }));

  // --- Script ---
  yyp = await loadYyp(dir);
  yyp = await addScript(dir, yyp, "scrTest", "function scrTest() { return 1; }\n");
  await writeYyp(dir, yyp);
  const script = JSON.parse(await fs.readFile(path.join(dir, "scripts/scrTest/scrTest.yy"), "utf8"));
  ok("script: top-level keys match real GameMaker schema", keysMatchRef(script, REF.script));

  // --- Edit script ---
  await editScript(dir, "scrTest", "function scrHelper() { return 2; }\n", "append");
  const appendedGml = await fs.readFile(path.join(dir, "scripts/scrTest/scrTest.gml"), "utf8");
  ok("editScript: append preserves original content", appendedGml.includes("function scrTest()"));
  ok("editScript: append adds new content", appendedGml.includes("function scrHelper()"));
  await expectThrows("editScript: rejects appending exact duplicate content", () =>
    editScript(dir, "scrTest", "function scrHelper() { return 2; }\n", "append"));
  await editScript(dir, "scrTest", "function scrTest() { return 99; }\n", "replace");
  const replacedGml = await fs.readFile(path.join(dir, "scripts/scrTest/scrTest.gml"), "utf8");
  ok("editScript: replace overwrites entirely", replacedGml.trim() === "function scrTest() { return 99; }");
  await expectThrows("editScript: rejects nonexistent script", () => editScript(dir, "scrDoesNotExist", "x", "append"));

  // --- Object ---
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objTest", [{ eventType: 0, eventNum: 0 }, { eventType: 3, eventNum: 0 }]);
  await writeYyp(dir, yyp);
  const obj = JSON.parse(await fs.readFile(path.join(dir, "objects/objTest/objTest.yy"), "utf8"));
  ok("object: top-level keys match real GameMaker schema", keysMatchRef(obj, REF.object));
  ok("object: event keys match", keysMatchRef(obj.eventList[0], REF.objectEvent));
  ok("object: eventNum passed through", obj.eventList[0].eventNum === 0);

  // --- Add event to existing object ---
  await addObjectEvent(dir, "objTest", { eventType: 8, eventNum: 0 }, "// custom draw code\n");
  const objWithNewEvent = JSON.parse(await fs.readFile(path.join(dir, "objects/objTest/objTest.yy"), "utf8"));
  ok("addObjectEvent: event count grew from 2 to 3", objWithNewEvent.eventList.length === 3);
  ok("addObjectEvent: new event keys match real schema", keysMatchRef(objWithNewEvent.eventList[2], REF.objectEvent));
  const newEventGml = await fs.readFile(path.join(dir, "objects/objTest/Draw_0.gml"), "utf8");
  ok("addObjectEvent: stub file has the given code", newEventGml.includes("custom draw code"));
  await expectThrows("addObjectEvent: rejects duplicate event", () => addObjectEvent(dir, "objTest", { eventType: 0, eventNum: 0 }));
  await expectThrows("addObjectEvent: rejects nonexistent object", () => addObjectEvent(dir, "objDoesNotExist", { eventType: 0, eventNum: 0 }));

  // --- Collision event targeting (was hardcoded to null, found during the
  // event-type-mapping task) ---
  await addObjectEvent(dir, "objTest", { eventType: 4, eventNum: 0, collisionTargetName: "objTest" }, "// collision code\n");
  const objWithCollision = JSON.parse(await fs.readFile(path.join(dir, "objects/objTest/objTest.yy"), "utf8"));
  const collisionEvent = objWithCollision.eventList.find((e: any) => e.eventType === 4);
  ok("addObjectEvent: collision target resolved to a real {name,path} reference",
    collisionEvent?.collisionObjectId?.name === "objTest" && collisionEvent?.collisionObjectId?.path === "objects/objTest/objTest.yy");
  await expectThrows("addObjectEvent: rejects a nonexistent collision target",
    () => addObjectEvent(dir, "objTest", { eventType: 4, eventNum: 1, collisionTargetName: "objDoesNotExist" }));

  // --- Event code files must use GameMaker's real naming (Create_0.gml,
  // Collision_<target>.gml) or GameMaker silently ignores them -- proven by
  // an Igor A/B compile: invalid GML in a wrong-named file compiles
  // "successfully", the same file under the real name fails. ---
  ok("event files: Create_0.gml, not <obj>_0_0.gml", await fileExists(path.join(dir, "objects/objTest/Create_0.gml")));
  ok("event files: Step_0.gml", await fileExists(path.join(dir, "objects/objTest/Step_0.gml")));
  ok("event files: Draw_0.gml for the added draw event", await fileExists(path.join(dir, "objects/objTest/Draw_0.gml")));
  ok("event files: collision file named after its target", await fileExists(path.join(dir, "objects/objTest/Collision_objTest.gml")));
  ok("event files: legacy <obj>_<type>_<num>.gml never written", !(await fileExists(path.join(dir, "objects/objTest/objTest_0_0.gml"))));

  // Collision events all share (type 4, num 0) legitimately, one per target
  // -- only a duplicate TARGET is a real duplicate.
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objOtherTarget", []);
  await writeYyp(dir, yyp);
  await addObjectEvent(dir, "objTest", { eventType: 4, eventNum: 0, collisionTargetName: "objOtherTarget" }, "// second collision\n");
  ok("collision events: second event with a different target allowed", await fileExists(path.join(dir, "objects/objTest/Collision_objOtherTarget.gml")));
  await expectThrows("collision events: same-target duplicate rejected",
    () => addObjectEvent(dir, "objTest", { eventType: 4, eventNum: 0, collisionTargetName: "objOtherTarget" }));
  await expectThrows("events: unknown eventType rejected", () => addObjectEvent(dir, "objTest", { eventType: 99, eventNum: 0 }));
  await expectThrows("events: negative eventNum rejected", () => addObjectEvent(dir, "objTest", { eventType: 8, eventNum: -1 }));

  // Renaming a collision TARGET must also rename Collision_<target>.gml in
  // every OTHER object's directory -- the target's name is in the filename,
  // not just the .yy content.
  yyp = await loadYyp(dir);
  yyp = await renameResource(dir, yyp, "objects", "objOtherTarget", "objOtherRenamed");
  await writeYyp(dir, yyp);
  ok("rename: external Collision_<target>.gml follows the target's rename",
    (await fileExists(path.join(dir, "objects/objTest/Collision_objOtherRenamed.gml"))) &&
    !(await fileExists(path.join(dir, "objects/objTest/Collision_objOtherTarget.gml"))));
  const secondCollisionContent = await fs.readFile(path.join(dir, "objects/objTest/Collision_objOtherRenamed.gml"), "utf8");
  ok("rename: renamed collision file keeps its code", secondCollisionContent.includes("second collision"));

  // --- Error messages distinguish "doesn't exist" from other real errors ---
  // Renaming a directory to look like the expected .yy path triggers EISDIR on
  // read, not ENOENT -- confirms we don't misreport a real error as "missing".
  const fakeObjDir = path.join(dir, "objects", "objFakeDirClash");
  await fs.mkdir(path.join(fakeObjDir, "objFakeDirClash.yy"), { recursive: true });
  try {
    await addObjectEvent(dir, "objFakeDirClash", { eventType: 0, eventNum: 0 });
    ok("error handling: distinguishes real errors from ENOENT", false, "expected an error");
  } catch (e: any) {
    ok("error handling: distinguishes real errors from ENOENT", !e.message.includes("does not exist"), e.message);
  }

  // --- Critical: editing a file GameMaker has resaved (trailing-comma JSON) ---
  // GameMaker's own writer uses trailing commas, invalid per strict JSON.parse.
  // A file we created can get resaved by the IDE at any point during normal
  // use -- editing must not silently break just because GameMaker touched it.
  const objTestYyPath = path.join(dir, "objects/objTest/objTest.yy");
  const rawObjText = await fs.readFile(objTestYyPath, "utf8");
  const gmStyleObj = rawObjText.replace(/(\n\s*)(\]|\})/, ",$1$2");
  await fs.writeFile(objTestYyPath, gmStyleObj, "utf8");
  try {
    await addObjectEvent(dir, "objTest", { eventType: 5, eventNum: 0 }, "// after GM resave\n");
    ok("handles GameMaker-resaved (trailing-comma) files", true);
  } catch (e: any) {
    ok("handles GameMaker-resaved (trailing-comma) files", false, e.message);
  }

  // --- Room instance placement ---
  const { instanceName } = await addRoomInstance(dir, "rmTest", "objTest", 288, 192, { rotation: 45 });
  const roomWithInstance = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmTest/rmTest.yy"), "utf8"));
  const placedInstance = roomWithInstance.layers[0].instances.find((i: any) => i.name === instanceName);
  ok("instance: was actually placed in the Instances layer", !!placedInstance);
  ok("instance: keys match real GameMaker schema", placedInstance && keysMatchRef(placedInstance, REF.roomInstance));
  ok("instance: position applied", placedInstance?.x === 288 && placedInstance?.y === 192);
  ok("instance: rotation applied", placedInstance?.rotation === 45);
  ok("instance: objectId references the right object", placedInstance?.objectId?.name === "objTest");
  ok("instance: registered in instanceCreationOrder", roomWithInstance.instanceCreationOrder.some((n: any) => n.name === instanceName));
  await expectThrows("instance: rejects nonexistent room", () => addRoomInstance(dir, "rmDoesNotExist", "objTest", 0, 0));
  await expectThrows("instance: rejects nonexistent object", () => addRoomInstance(dir, "rmTest", "objDoesNotExist", 0, 0));

  // --- Sprite ---
  yyp = await loadYyp(dir);
  const framesDir = path.join(dir, "_frames_src");
  await fs.mkdir(framesDir, { recursive: true });
  await fs.copyFile(path.join(process.cwd(), "test/fixtures/frame0.png"), path.join(framesDir, "frame0.png"));
  yyp = await addSpriteFromImages(dir, yyp, "sprTest", framesDir);
  await writeYyp(dir, yyp);
  const sprite = JSON.parse(await fs.readFile(path.join(dir, "sprites/sprTest/sprTest.yy"), "utf8"));
  ok("sprite: top-level keys match real GameMaker schema", keysMatchRef(sprite, REF.sprite));
  ok("sprite: frame keys match", keysMatchRef(sprite.frames[0], REF.spriteFrame));
  ok("sprite: layer keys match", keysMatchRef(sprite.layers[0], REF.spriteLayer));
  ok("sprite: sequence keys match", keysMatchRef(sprite.sequence, REF.spriteSequence));
  ok("sprite: dimensions read from actual PNG (16x24)", sprite.width === 16 && sprite.height === 24, `got ${sprite.width}x${sprite.height}`);
  ok("sprite: bbox derived from dimensions", sprite.bbox_right === 15 && sprite.bbox_bottom === 23);
  ok("sprite: TextureGroups 'Default' entry registered (a genuinely bare project has none by default)",
    ((yyp as any).TextureGroups ?? []).some((g: any) => g.name === "Default"));
  const frameId = sprite.frames[0].name;
  const layerId = sprite.layers[0].name;
  ok("sprite: flat composite PNG exists", await fileExists(path.join(dir, `sprites/sprTest/${frameId}.png`)));
  ok("sprite: per-frame per-layer source PNG exists (GameMaker refuses to load without this)",
    await fileExists(path.join(dir, `sprites/sprTest/layers/${frameId}/${layerId}.png`)));

  await editSprite(dir, "sprTest", { xorigin: 8, yorigin: 12, collisionKind: 1 });
  const editedSprite = JSON.parse(await fs.readFile(path.join(dir, "sprites/sprTest/sprTest.yy"), "utf8"));
  ok("editSprite: origin updated and preset flipped to Custom", editedSprite.sequence.xorigin === 8 && editedSprite.sequence.yorigin === 12 && editedSprite.origin === 9);
  ok("editSprite: collisionKind updated", editedSprite.collisionKind === 1);
  ok("editSprite: frame/dimension data untouched by edit", editedSprite.width === 16 && editedSprite.height === 24 && editedSprite.frames.length === 1);
  await expectThrows("editSprite: rejects nonexistent sprite", () => editSprite(dir, "sprDoesNotExist", { xorigin: 0 }));

  // --- Read-tool parity ---
  const objInfo = await getObjectInfo(dir, "objTest");
  ok("getObjectInfo: reports correct name", objInfo.name === "objTest");
  ok("getObjectInfo: reports all events with human-readable names",
    objInfo.events.length === 6 && objInfo.events[0].type === "Create" && objInfo.events[2].type === "Draw" && objInfo.events[3].type === "Collision",
    JSON.stringify(objInfo.events));
  await expectThrows("getObjectInfo: rejects nonexistent object", () => getObjectInfo(dir, "objDoesNotExist"));

  const roomInfo = await getRoomInfo(dir, "rmTest");
  ok("getRoomInfo: reports resized dimensions", roomInfo.width === 1024 && roomInfo.height === 768);
  ok("getRoomInfo: reports persistent flag", roomInfo.persistent === true);
  ok("getRoomInfo: reports the placed instance", roomInfo.instanceCount === 1 && roomInfo.instances[0].object === "objTest");
  await expectThrows("getRoomInfo: rejects nonexistent room", () => getRoomInfo(dir, "rmDoesNotExist"));

  const spriteInfo = await getSpriteInfo(dir, "sprTest");
  ok("getSpriteInfo: reports real dimensions from PNG", spriteInfo.width === 16 && spriteInfo.height === 24);
  ok("getSpriteInfo: reports frame count", spriteInfo.frameCount === 1);
  await expectThrows("getSpriteInfo: rejects nonexistent sprite", () => getSpriteInfo(dir, "sprDoesNotExist"));

  const scriptInfo = await getScriptInfo(dir, "scrTest");
  ok("getScriptInfo: reports current (replaced) code", scriptInfo.code.includes("return 99"));
  await expectThrows("getScriptInfo: rejects nonexistent script", () => getScriptInfo(dir, "scrDoesNotExist"));

  // --- Shader ---
  yyp = await loadYyp(dir);
  yyp = await addShader(dir, yyp, "shTest");
  await writeYyp(dir, yyp);
  const shader = JSON.parse(await fs.readFile(path.join(dir, "shaders/shTest/shTest.yy"), "utf8"));
  ok("shader: top-level keys match real GameMaker schema", keysMatchRef(shader, REF.shader));
  ok("shader: vsh file exists", await fileExists(path.join(dir, "shaders/shTest/shTest.vsh")));
  ok("shader: fsh file exists", await fileExists(path.join(dir, "shaders/shTest/shTest.fsh")));
  ok("shader: Shaders folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Shaders.yy"));
  const shaderInfo = await getShaderInfo(dir, "shTest");
  ok("getShaderInfo: reports both code files", shaderInfo.vertexCode.length > 0 && shaderInfo.fragmentCode.length > 0);
  await expectThrows("addShader: rejects invalid name", () => addShader(dir, yyp, "1BadShader"));

  // Valid GLSL (not a bare comment) -- this project stays shared with the
  // later real Igor compile test, and an editShader call leaving invalid
  // shader code in place would break that unrelated test.
  const editedVsh = "attribute vec3 in_Position;\nvoid main() { gl_Position = vec4(in_Position, 1.0); }\n";
  const editedFsh = "void main() { gl_FragColor = vec4(1.0); }\n";
  await editShader(dir, "shTest", { vertexCode: editedVsh, fragmentCode: editedFsh });
  ok("editShader: vertex code updated", (await fs.readFile(path.join(dir, "shaders/shTest/shTest.vsh"), "utf8")) === editedVsh);
  ok("editShader: fragment code updated", (await fs.readFile(path.join(dir, "shaders/shTest/shTest.fsh"), "utf8")) === editedFsh);
  await expectThrows("editShader: rejects nonexistent shader", () => editShader(dir, "shDoesNotExist", { vertexCode: "x" }));

  // --- Sound ---
  yyp = await loadYyp(dir);
  yyp = await addSound(dir, yyp, "sndTest", path.join(process.cwd(), "test/fixtures/beep.wav"));
  await writeYyp(dir, yyp);
  const sound = JSON.parse(await fs.readFile(path.join(dir, "sounds/sndTest/sndTest.yy"), "utf8"));
  ok("sound: top-level keys match real GameMaker schema (per @bscotch/yy v2)", keysMatchRef(sound, REF.sound));
  ok("sound: audio file copied", await fileExists(path.join(dir, "sounds/sndTest/sndTest.wav")));
  ok("sound: soundFile field correct", sound.soundFile === "sndTest.wav");
  ok("sound: Sounds folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Sounds.yy"));
  ok("sound: real sample rate derived from WAV header (not hardcoded)", sound.sampleRate === 44100);
  ok("sound: real channel count derived (mono -> channelFormat 0)", sound.channelFormat === 0);
  ok("sound: real bit depth derived (16-bit -> bitDepth 1)", sound.bitDepth === 1);
  ok("sound: real duration computed from data chunk size", Math.abs(sound.duration - 0.1) < 0.01, `got ${sound.duration}`);
  ok("sound: AudioGroups 'audiogroup_default' entry registered (a genuinely bare project has none by default)",
    ((yyp as any).AudioGroups ?? []).some((g: any) => g.name === "audiogroup_default"));
  const soundInfo = await getSoundInfo(dir, "sndTest");
  ok("getSoundInfo: reports soundFile", soundInfo.soundFile === "sndTest.wav");
  await expectThrows("addSound: rejects non-wav format", () =>
    addSound(dir, yyp, "sndBad", path.join(process.cwd(), "test/fixtures/frame0.png")));
  await expectThrows("addSound: rejects unsupported sample rate", () =>
    addSound(dir, yyp, "sndBadRate", path.join(process.cwd(), "test/fixtures/badrate.wav")));

  await editSound(dir, "sndTest", { volume: 0.5, preload: false });
  const editedSound = JSON.parse(await fs.readFile(path.join(dir, "sounds/sndTest/sndTest.yy"), "utf8"));
  ok("editSound: volume/preload updated", editedSound.volume === 0.5 && editedSound.preload === false);
  ok("editSound: real audio metadata untouched by edit", editedSound.sampleRate === 44100 && editedSound.channelFormat === 0);
  await expectThrows("editSound: rejects nonexistent sound", () => editSound(dir, "sndDoesNotExist", { volume: 1 }));

  // --- Font ---
  yyp = await loadYyp(dir);
  const fontResult = await addFont(dir, yyp, "fntTest", "Arial", { size: 16, bold: true });
  yyp = fontResult.yyp;
  await writeYyp(dir, yyp);
  const font = JSON.parse(await fs.readFile(path.join(dir, "fonts/fntTest/fntTest.yy"), "utf8"));
  ok("font: top-level keys match real Convoy font schema", keysMatchRef(font, REF.font));
  ok("font: system font name applied", font.fontName === "Arial");
  ok("font: size/bold applied", font.size === 16 && font.bold === true);
  ok("font: Fonts folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Fonts.yy"));
  const fontInfo = await getFontInfo(dir, "fntTest");
  ok("getFontInfo: reports system font name", fontInfo.systemFontName === "Arial");
  ok("addFont: no warning for a real, near-universal Windows font (Arial)", fontResult.warning === null);
  await expectThrows("addFont: rejects invalid name", () => addFont(dir, yyp, "1BadFont", "Arial"));

  yyp = await loadYyp(dir);
  const badFontResult = await addFont(dir, yyp, "fntBogus", "TotallyNotARealFontXYZ123");
  yyp = badFontResult.yyp;
  await writeYyp(dir, yyp);
  ok("addFont: warns (but still creates) when the system font isn't installed",
    badFontResult.warning === null || badFontResult.warning.includes("TotallyNotARealFontXYZ123"),
    "warning should either be null (registry unreadable -- skip gracefully) or explicitly name the missing font");
  ok("addFont: resource is created even when the font doesn't exist (visual issue, not a crash risk)",
    await fileExists(path.join(dir, "fonts/fntBogus/fntBogus.yy")));

  const editFontResult = await editFont(dir, "fntTest", { size: 20, bold: false, italic: true });
  const editedFont = JSON.parse(await fs.readFile(path.join(dir, "fonts/fntTest/fntTest.yy"), "utf8"));
  ok("editFont: size/bold/italic updated", editedFont.size === 20 && editedFont.bold === false && editedFont.italic === true);
  ok("editFont: styleName recomputed", editedFont.styleName === "Italic");
  ok("editFont: no warning editing size only (font name unchanged)", editFontResult.warning === null);
  await expectThrows("editFont: rejects nonexistent font", () => editFont(dir, "fntDoesNotExist", { size: 10 }));

  // --- Tileset (sprTest is a real 16x24 sprite added earlier) ---
  yyp = await loadYyp(dir);
  yyp = await addTileset(dir, yyp, "tsTest", "sprTest", 8, 8);
  await writeYyp(dir, yyp);
  const tileset = JSON.parse(await fs.readFile(path.join(dir, "tilesets/tsTest/tsTest.yy"), "utf8"));
  ok("tileset: top-level keys match real Convoy tileset schema", keysMatchRef(tileset, REF.tileset));
  ok("tileset: sprite reference correct", tileset.spriteId.name === "sprTest" && tileset.spriteId.path === "sprites/sprTest/sprTest.yy");
  ok("tileset: tile dimensions applied", tileset.tileWidth === 8 && tileset.tileHeight === 8);
  ok("tileset: columns/rows/count derived from real 16x24 sprite (2x3=6 tiles of 8x8)",
    tileset.out_columns === 2 && tileset.tile_count === 6, `got columns=${tileset.out_columns} count=${tileset.tile_count}`);
  ok("tileset: Tilesets folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Tilesets.yy"));
  const tilesetInfo = await getTilesetInfo(dir, "tsTest");
  ok("getTilesetInfo: reports sprite and tile dimensions", tilesetInfo.sprite === "sprTest" && tilesetInfo.tileWidth === 8 && tilesetInfo.tileCount === 6);
  await expectThrows("addTileset: rejects invalid name", () => addTileset(dir, yyp, "1BadTileset", "sprTest", 8, 8));
  await expectThrows("addTileset: rejects a nonexistent source sprite", () => addTileset(dir, yyp, "tsNoSprite", "sprDoesNotExist", 8, 8));

  await editTileset(dir, "tsTest", { tileWidth: 4, tileHeight: 4 });
  const editedTileset = JSON.parse(await fs.readFile(path.join(dir, "tilesets/tsTest/tsTest.yy"), "utf8"));
  ok("editTileset: tile dimensions updated", editedTileset.tileWidth === 4 && editedTileset.tileHeight === 4);
  ok("editTileset: columns/count recomputed from real sprite (16/4=4 cols, 24/4=6 rows, 24 tiles)",
    editedTileset.out_columns === 4 && editedTileset.tile_count === 24, `got columns=${editedTileset.out_columns} count=${editedTileset.tile_count}`);
  await expectThrows("editTileset: rejects nonexistent tileset", () => editTileset(dir, "tsDoesNotExist", { tileWidth: 4 }));

  yyp = await renameResource(dir, yyp, "tilesets", "tsTest", "tsRenamed");
  await writeYyp(dir, yyp);
  ok("renameResource: works on tilesets", await fileExists(path.join(dir, "tilesets/tsRenamed/tsRenamed.yy"))
    && !(await fileExists(path.join(dir, "tilesets/tsTest"))));

  yyp = await deleteResource(dir, yyp, "tilesets", "tsRenamed");
  await writeYyp(dir, yyp);
  ok("deleteResource: works on tilesets", !(await fileExists(path.join(dir, "tilesets/tsRenamed"))));

  // --- Extension (empty shell -- real ground truth has no populated
  // functions/constants example available, see module comment) ---
  yyp = await loadYyp(dir);
  yyp = await addExtension(dir, yyp, "extTest");
  await writeYyp(dir, yyp);
  const extension = JSON.parse(await fs.readFile(path.join(dir, "extensions/extTest/extTest.yy"), "utf8"));
  ok("extension: top-level keys match real bscotch/stitch sample schema", keysMatchRef(extension, REF.extension));
  ok("extension: resourceVersion matches real sample (2.0, not @bscotch/yy's stale 1.2 default)", extension.resourceVersion === "2.0");
  ok("extension: Extensions folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Extensions.yy"));
  const extensionInfo = await getExtensionInfo(dir, "extTest");
  ok("getExtensionInfo: reports version and file count", extensionInfo.extensionVersion === "0.0.1" && extensionInfo.fileCount === 0);
  await expectThrows("addExtension: rejects invalid name", () => addExtension(dir, yyp, "1BadExtension"));

  yyp = await renameResource(dir, yyp, "extensions", "extTest", "extRenamed");
  await writeYyp(dir, yyp);
  ok("renameResource: works on extensions", await fileExists(path.join(dir, "extensions/extRenamed/extRenamed.yy"))
    && !(await fileExists(path.join(dir, "extensions/extTest"))));

  yyp = await deleteResource(dir, yyp, "extensions", "extRenamed");
  await writeYyp(dir, yyp);
  ok("deleteResource: works on extensions", !(await fileExists(path.join(dir, "extensions/extRenamed"))));

  // --- Particle system (real ground truth from a published GameMaker
  // project, see module comment for the version-drift caveat) ---
  yyp = await loadYyp(dir);
  yyp = await addParticleSystem(dir, yyp, "partTest");
  await writeYyp(dir, yyp);
  const particleSystem = JSON.parse(await fs.readFile(path.join(dir, "particles/partTest/partTest.yy"), "utf8"));
  ok("particleSystem: top-level keys match real captured schema", keysMatchRef(particleSystem, REF.particleSystem));
  ok("particleSystem: has one default emitter", particleSystem.emitters.length === 1);
  ok("particleSystem: emitter keys match real captured schema", keysMatchRef(particleSystem.emitters[0], REF.particleEmitter));
  ok("particleSystem: Particles folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Particles.yy"));
  const particleSystemInfo = await getParticleSystemInfo(dir, "partTest");
  ok("getParticleSystemInfo: reports emitter count and names", particleSystemInfo.emitterCount === 1 && particleSystemInfo.emitterNames[0] === "Emitter");
  await expectThrows("addParticleSystem: rejects invalid name", () => addParticleSystem(dir, yyp, "1BadParticleSystem"));

  yyp = await renameResource(dir, yyp, "particles", "partTest", "partRenamed");
  await writeYyp(dir, yyp);
  ok("renameResource: works on particle systems", await fileExists(path.join(dir, "particles/partRenamed/partRenamed.yy"))
    && !(await fileExists(path.join(dir, "particles/partTest"))));

  yyp = await deleteResource(dir, yyp, "particles", "partRenamed");
  await writeYyp(dir, yyp);
  ok("deleteResource: works on particle systems", !(await fileExists(path.join(dir, "particles/partRenamed"))));

  // --- Animation curve (real ground truth from @bscotch/yy's own sample
  // fixtures, see module comment for the version-drift caveat) ---
  yyp = await loadYyp(dir);
  yyp = await addAnimCurve(dir, yyp, "curveTest");
  await writeYyp(dir, yyp);
  const animCurve = JSON.parse(await fs.readFile(path.join(dir, "animcurves/curveTest/curveTest.yy"), "utf8"));
  ok("animCurve: top-level keys match real captured schema", keysMatchRef(animCurve, REF.animCurve));
  ok("animCurve: has one default channel", animCurve.channels.length === 1);
  ok("animCurve: channel keys match real captured schema", keysMatchRef(animCurve.channels[0], REF.animCurveChannel));
  ok("animCurve: straight line from (0,0) to (1,1)", animCurve.channels[0].points.length === 2
    && animCurve.channels[0].points[0].x === 0 && animCurve.channels[0].points[0].y === 0
    && animCurve.channels[0].points[1].x === 1 && animCurve.channels[0].points[1].y === 1);
  ok("animCurve: Animation Curves folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Animation Curves.yy"));
  const animCurveInfo = await getAnimCurveInfo(dir, "curveTest");
  ok("getAnimCurveInfo: reports channel count, names, and point counts", animCurveInfo.channelCount === 1
    && animCurveInfo.channelNames[0] === "channel0" && animCurveInfo.pointCounts[0] === 2);
  await expectThrows("addAnimCurve: rejects invalid name", () => addAnimCurve(dir, yyp, "1BadAnimCurve"));

  yyp = await renameResource(dir, yyp, "animcurves", "curveTest", "curveRenamed");
  await writeYyp(dir, yyp);
  ok("renameResource: works on animation curves", await fileExists(path.join(dir, "animcurves/curveRenamed/curveRenamed.yy"))
    && !(await fileExists(path.join(dir, "animcurves/curveTest"))));

  yyp = await deleteResource(dir, yyp, "animcurves", "curveRenamed");
  await writeYyp(dir, yyp);
  ok("deleteResource: works on animation curves", !(await fileExists(path.join(dir, "animcurves/curveRenamed"))));

  // --- Validation edge cases (rooms, representative of all four writers) ---
  const badNames = ["", "../../etc", "rooms/evil", "evil\\room", "1Room", "my room", "room.yy", "r".repeat(101)];
  for (const name of badNames) {
    yyp = await loadYyp(dir);
    await expectThrows(`rejects invalid name: ${JSON.stringify(name)}`, () =>
      addRoom(dir, yyp, name, { width: 100, height: 100, persistent: false }));
  }
  yyp = await loadYyp(dir);
  await expectThrows("rejects duplicate name (exact)", () =>
    addRoom(dir, yyp, "rmTest", { width: 100, height: 100, persistent: false }));
  await expectThrows("rejects duplicate name (case-insensitive)", () =>
    addRoom(dir, yyp, "RMTEST", { width: 100, height: 100, persistent: false }));

  // --- Folder no-op on already-organized state ---
  const foldersBefore = ((yyp as any).Folders ?? []).length;
  yyp = await addRoom(dir, yyp, "rmSecond", { width: 100, height: 100, persistent: false });
  const foldersAfter = ((yyp as any).Folders ?? []).length;
  ok("Rooms folder not duplicated on second room add", foldersBefore === foldersAfter);

  // --- Texture/audio groups: explicit add (throws on collision), distinct
  // from ensureX's silent auto-provisioning no-op ---
  yyp = await loadYyp(dir);
  addTextureGroup(yyp, "HighRes");
  ok("addTextureGroup: new group registered", ((yyp as any).TextureGroups ?? []).some((g: any) => g.name === "HighRes"));
  await expectThrows("addTextureGroup: rejects a name that already exists", async () => addTextureGroup(yyp, "HighRes"));
  await expectThrows("addTextureGroup: rejects collision with the auto-provisioned Default group", async () => addTextureGroup(yyp, "Default"));

  addAudioGroup(yyp, "Music");
  ok("addAudioGroup: new group registered", ((yyp as any).AudioGroups ?? []).some((g: any) => g.name === "Music"));
  await expectThrows("addAudioGroup: rejects a name that already exists", async () => addAudioGroup(yyp, "Music"));
  await writeYyp(dir, yyp);

  // --- writeYyp atomicity: a failed write must not corrupt the real .yyp file ---
  {
    const yypFileName = (await fs.readdir(dir)).find(f => f.endsWith(".yyp"))!;
    const yypPath = path.join(dir, yypFileName);
    const goodContentBefore = await fs.readFile(yypPath, "utf8");

    const badYyp = { ...(await loadYyp(dir)), resources: "not-an-array" as any };
    let threw = false;
    try {
      await writeYyp(dir, badYyp);
    } catch {
      threw = true;
    }
    ok("writeYyp: throws on invalid data instead of silently writing it", threw);

    const contentAfterFailedWrite = await fs.readFile(yypPath, "utf8");
    ok("writeYyp: original file untouched after a failed write", contentAfterFailedWrite === goodContentBefore);

    const leftoverTemp = (await fs.readdir(dir)).some(f => f.includes(".tmp-"));
    ok("writeYyp: no leftover temp file after a failed write", !leftoverTemp);
  }

  // --- Reference search + safe delete ---
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objRefTarget", []);
  await writeYyp(dir, yyp);
  yyp = await addRoom(dir, yyp, "rmRefHolder", { width: 400, height: 300, persistent: false });
  await writeYyp(dir, yyp);
  await addRoomInstance(dir, "rmRefHolder", "objRefTarget", 10, 10);

  const refs = await findReferences(dir, "objRefTarget");
  ok("findReferences: finds the room that placed an instance of it", refs.some(r => r.file.includes("rmRefHolder")));
  ok("findReferences: excludes the resource's own files", !refs.some(r => r.file.includes("objRefTarget.yy")));
  await expectThrows("findReferences: rejects an empty resourceName instead of matching almost everything", () => findReferences(dir, ""));

  yyp = await loadYyp(dir);
  let caughtInUse = false;
  try {
    await deleteResource(dir, yyp, "objects", "objRefTarget");
  } catch (e) {
    caughtInUse = e instanceof ResourceInUseError;
  }
  ok("deleteResource: refuses to delete a referenced resource", caughtInUse);
  ok("objRefTarget: still exists on disk after refused delete", await fileExists(path.join(dir, "objects/objRefTarget/objRefTarget.yy")));

  yyp = await deleteResource(dir, yyp, "objects", "objRefTarget", true);
  await writeYyp(dir, yyp);
  ok("deleteResource: force=true deletes a referenced resource", !(await fileExists(path.join(dir, "objects/objRefTarget/objRefTarget.yy"))));
  ok("deleteResource: removed from yyp.resources", !yyp.resources.some((r: any) => r.id?.name === "objRefTarget"));

  yyp = await loadYyp(dir);
  yyp = await addScript(dir, yyp, "scrUnreferenced", "function scrUnreferenced() { return 1; }\n");
  await writeYyp(dir, yyp);
  yyp = await deleteResource(dir, yyp, "scripts", "scrUnreferenced");
  await writeYyp(dir, yyp);
  ok("deleteResource: deletes an unreferenced resource without needing force", !(await fileExists(path.join(dir, "scripts/scrUnreferenced/scrUnreferenced.yy"))));

  yyp = await loadYyp(dir);
  const roomOrderBefore = ((yyp as any).RoomOrderNodes ?? []).length;
  yyp = await deleteResource(dir, yyp, "rooms", "rmRefHolder", true);
  await writeYyp(dir, yyp);
  const roomOrderAfter = ((yyp as any).RoomOrderNodes ?? []).length;
  ok("deleteResource: removes deleted room from RoomOrderNodes", roomOrderAfter === roomOrderBefore - 1);

  await expectThrows("deleteResource: rejects nonexistent resource", () =>
    deleteResource(dir, yyp, "objects", "objTotallyMadeUp"));

  // --- Path traversal: every tool taking an EXISTING resource's name must
  // reject a name that isn't a plain identifier before it reaches path.join,
  // not just the create-a-new-resource tools ---
  const traversalName = "../../../../Windows/System32/Tasks";
  await expectThrows("deleteResource: rejects path traversal in resourceName", () =>
    deleteResource(dir, yyp, "objects", traversalName));
  await expectThrows("renameResource: rejects path traversal in oldName", () =>
    renameResource(dir, yyp, "objects", traversalName, "objWhatever"));
  await expectThrows("renameResource: rejects path traversal in newName", () =>
    renameResource(dir, yyp, "scripts", "scrTest", traversalName));
  await expectThrows("editScript: rejects path traversal in scriptName", () =>
    editScript(dir, traversalName, "function evil() {}", "replace"));
  await expectThrows("addObjectEvent: rejects path traversal in objectName", () =>
    addObjectEvent(dir, traversalName, { eventType: 3, eventNum: 0 }));
  await expectThrows("editRoom: rejects path traversal in roomName", () =>
    editRoom(dir, traversalName, { width: 100 }));
  await expectThrows("addRoomInstance: rejects path traversal in roomName", () =>
    addRoomInstance(dir, traversalName, "objTest", 0, 0));
  await expectThrows("addRoomInstance: rejects path traversal in objectName", () =>
    addRoomInstance(dir, "rmTest", traversalName, 0, 0));
  await expectThrows("getObjectInfo: rejects path traversal", () => getObjectInfo(dir, traversalName));
  await expectThrows("getScriptInfo: rejects path traversal", () => getScriptInfo(dir, traversalName));

  // --- Rename (riskiest writer -- must rewrite every reference, not just detect them) ---
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objRenameMe", []);
  await writeYyp(dir, yyp);
  yyp = await addRoom(dir, yyp, "rmRenameHolder", { width: 400, height: 300, persistent: false });
  await writeYyp(dir, yyp);
  await addRoomInstance(dir, "rmRenameHolder", "objRenameMe", 50, 60);

  yyp = await loadYyp(dir);
  yyp = await renameResource(dir, yyp, "objects", "objRenameMe", "objRenamedTarget");
  await writeYyp(dir, yyp);

  ok("rename: old object directory gone", !(await fileExists(path.join(dir, "objects/objRenameMe"))));
  ok("rename: new object directory exists", await fileExists(path.join(dir, "objects/objRenamedTarget/objRenamedTarget.yy")));
  const renamedObj = JSON.parse(await fs.readFile(path.join(dir, "objects/objRenamedTarget/objRenamedTarget.yy"), "utf8"));
  ok("rename: object's own name field updated", renamedObj.name === "objRenamedTarget" && renamedObj["%Name"] === "objRenamedTarget");
  ok("rename: yyp.resources entry updated", yyp.resources.some((r: any) => r.id?.name === "objRenamedTarget")
    && !yyp.resources.some((r: any) => r.id?.name === "objRenameMe"));

  const roomAfterRename = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmRenameHolder/rmRenameHolder.yy"), "utf8"));
  const renamedInstance = roomAfterRename.layers[0].instances[0];
  ok("rename: room's instance objectId.name updated", renamedInstance.objectId.name === "objRenamedTarget");
  ok("rename: room's instance objectId.path updated", renamedInstance.objectId.path === "objects/objRenamedTarget/objRenamedTarget.yy");

  const staleRefs = await findReferences(dir, "objRenameMe", false);
  ok("rename: zero references to the old name remain anywhere", staleRefs.length === 0, JSON.stringify(staleRefs));

  // Room rename, specifically covering a room's self-referencing creationCodeFile path
  yyp = await loadYyp(dir);
  yyp = await addRoom(dir, yyp, "rmOldRoomName", { width: 200, height: 200, persistent: false, creationCode: "show_debug_message(1);" });
  await writeYyp(dir, yyp);
  yyp = await loadYyp(dir);
  yyp = await renameResource(dir, yyp, "rooms", "rmOldRoomName", "rmNewRoomName");
  await writeYyp(dir, yyp);
  const renamedRoom = JSON.parse(await fs.readFile(path.join(dir, "rooms/rmNewRoomName/rmNewRoomName.yy"), "utf8"));
  ok("rename (room): self-referencing creationCodeFile path updated", renamedRoom.creationCodeFile === "rooms/rmNewRoomName/RoomCreationCode.gml");
  ok("rename (room): RoomOrderNodes updated", ((yyp as any).RoomOrderNodes ?? []).some((n: any) => n.roomId?.name === "rmNewRoomName")
    && !((yyp as any).RoomOrderNodes ?? []).some((n: any) => n.roomId?.name === "rmOldRoomName"));

  // Regression: a rename that fails partway through must roll back
  // everything already done -- external files, own file contents, and any
  // files already renamed -- rather than leave the project half-migrated.
  // Force a real failure at the "rename own files" step by pre-creating a
  // file at the exact path one of those renames would target.
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objRollbackTest", [{ eventType: 0, eventNum: 0 }]);
  await writeYyp(dir, yyp);
  yyp = await addRoom(dir, yyp, "rmRollbackHolder", { width: 100, height: 100, persistent: false });
  await writeYyp(dir, yyp);
  await addRoomInstance(dir, "rmRollbackHolder", "objRollbackTest", 0, 0);

  const rollbackObjDir = path.join(dir, "objects/objRollbackTest");
  const rollbackYyPath = path.join(rollbackObjDir, "objRollbackTest.yy");
  const rollbackEventPath = path.join(rollbackObjDir, "Create_0.gml");
  const rollbackRoomPath = path.join(dir, "rooms/rmRollbackHolder/rmRollbackHolder.yy");
  const originalYyContent = await fs.readFile(rollbackYyPath, "utf8");
  const originalEventContent = await fs.readFile(rollbackEventPath, "utf8");
  const originalRoomContent = await fs.readFile(rollbackRoomPath, "utf8");

  // Conflicts with the rename target for the object's own .yy, forcing
  // fs.rename to throw partway through step 3 -- a directory (not a file)
  // sitting at the target path reliably fails a file-to-that-path rename.
  await fs.mkdir(path.join(rollbackObjDir, "objRollbackNew.yy"), { recursive: true });

  yyp = await loadYyp(dir);
  let rollbackThrew = false;
  try {
    await renameResource(dir, yyp, "objects", "objRollbackTest", "objRollbackNew");
  } catch {
    rollbackThrew = true;
  }
  ok("rename rollback: the forced failure actually threw", rollbackThrew);
  ok("rename rollback: object directory still has the old name", await fileExists(rollbackYyPath));
  ok("rename rollback: object .yy content fully restored", await fs.readFile(rollbackYyPath, "utf8") === originalYyContent);
  ok("rename rollback: event stub content fully restored", await fs.readFile(rollbackEventPath, "utf8") === originalEventContent);
  ok("rename rollback: external room reference fully restored", await fs.readFile(rollbackRoomPath, "utf8") === originalRoomContent);
  ok("rename rollback: new directory was never left behind", !(await fileExists(path.join(dir, "objects/objRollbackNew"))));
  await fs.rm(path.join(rollbackObjDir, "objRollbackNew.yy"), { recursive: true, force: true });

  // Regression: renaming must NOT touch a coincidentally-matching "name"
  // field that isn't actually a reference to the resource -- only the
  // file's own root identity and real {name, path} reference pairs
  // (objectId, spriteId, etc.) should change. A room's own layer has a
  // "name"/"%Name" of its own (normally "Instances") with no sibling
  // "path" key -- if a user renamed that layer to match an object's name,
  // it must survive the object's rename untouched, while the real instance
  // reference in the same file does get updated.
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objCoincidence", []);
  await writeYyp(dir, yyp);
  yyp = await addRoom(dir, yyp, "rmCoincidenceHolder", { width: 200, height: 200, persistent: false });
  await writeYyp(dir, yyp);
  await addRoomInstance(dir, "rmCoincidenceHolder", "objCoincidence", 0, 0);
  const coincidenceRoomPath = path.join(dir, "rooms/rmCoincidenceHolder/rmCoincidenceHolder.yy");
  const coincidenceRoom = JSON.parse(await fs.readFile(coincidenceRoomPath, "utf8"));
  coincidenceRoom.layers[0].name = "objCoincidence";
  coincidenceRoom.layers[0]["%Name"] = "objCoincidence";
  await fs.writeFile(coincidenceRoomPath, JSON.stringify(coincidenceRoom, null, 2), "utf8");

  yyp = await loadYyp(dir);
  yyp = await renameResource(dir, yyp, "objects", "objCoincidence", "objCoincidenceRenamed");
  await writeYyp(dir, yyp);
  const afterCoincidenceRename = JSON.parse(await fs.readFile(coincidenceRoomPath, "utf8"));
  ok("rename: real instance reference IS updated", afterCoincidenceRename.layers[0].instances[0].objectId.name === "objCoincidenceRenamed");
  ok("rename: coincidentally-matching layer name (no sibling path) is left untouched",
    afterCoincidenceRename.layers[0].name === "objCoincidence" && afterCoincidenceRename.layers[0]["%Name"] === "objCoincidence");

  // Regression: a "var <name>" local variable declaration in .gml code that
  // happens to share the resource's exact name must survive a rename of
  // that resource untouched -- scoped mitigation, not full GML-aware
  // precision (a later bare usage of that same local on another line is a
  // known, documented residual gap without a real GML parser).
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objShadowRename", []);
  await writeYyp(dir, yyp);
  yyp = await addScript(dir, yyp, "scrShadowTest", "function scrShadowTest() {\n  var objShadowRename = 123;\n  return objShadowRename;\n}\n");
  await writeYyp(dir, yyp);

  yyp = await renameResource(dir, yyp, "objects", "objShadowRename", "objShadowRenamed");
  await writeYyp(dir, yyp);
  const shadowScriptGml = await fs.readFile(path.join(dir, "scripts/scrShadowTest/scrShadowTest.gml"), "utf8");
  ok("rename: a 'var <name>' local declaration line is left untouched", shadowScriptGml.includes("var objShadowRename = 123;"));

  // Guard rails
  await expectThrows("rename: rejects same old/new name", () => renameResource(dir, yyp, "rooms", "rmNewRoomName", "rmNewRoomName"));
  await expectThrows("rename: rejects invalid new name", () => renameResource(dir, yyp, "rooms", "rmNewRoomName", "1BadName"));
  await expectThrows("rename: rejects collision with existing resource", () => renameResource(dir, yyp, "rooms", "rmNewRoomName", "rmRenameHolder"));
  await expectThrows("rename: rejects nonexistent resource", () => renameResource(dir, yyp, "rooms", "rmDoesNotExist", "rmWhatever"));

  // --- Concurrency: withProjectLock must serialize operations against the
  // same key (this is what stops two racing MCP tool calls from each loading
  // their own copy of the yyp and whoever writes last silently discarding
  // the other's changes), while NOT serializing unrelated project keys ---
  {
    let counter = 0;
    const increment = () => withProjectLock("verify-lock-key", async () => {
      const before = counter;
      await new Promise(r => setTimeout(r, 10));
      counter = before + 1;
    });
    await Promise.all([increment(), increment(), increment(), increment(), increment()]);
    ok("withProjectLock: serializes concurrent operations on the same key (no lost updates)", counter === 5, `expected 5, got ${counter}`);

    let activeCount = 0;
    let sawBothActiveAtOnce = false;
    const track = (key: string) => withProjectLock(key, async () => {
      activeCount++;
      if (activeCount >= 2) sawBothActiveAtOnce = true;
      await new Promise(r => setTimeout(r, 20));
      activeCount--;
    });
    await Promise.all([track("verify-lock-key-A"), track("verify-lock-key-B")]);
    ok("withProjectLock: different keys are not serialized against each other", sawBothActiveAtOnce);
  }

  // --- Lint tool: build a fresh, isolated, known-good cluster, then corrupt
  // one specific thing at a time and confirm each corruption is caught ---
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objLintTarget", []);
  await writeYyp(dir, yyp);
  yyp = await addRoom(dir, yyp, "rmLintHolder", { width: 400, height: 300, persistent: false });
  await writeYyp(dir, yyp);
  await addRoomInstance(dir, "rmLintHolder", "objLintTarget", 0, 0);
  yyp = await loadYyp(dir);
  yyp = await addSound(dir, yyp, "sndLintTarget", path.join(process.cwd(), "test/fixtures/beep.wav"));
  await writeYyp(dir, yyp);
  yyp = await loadYyp(dir);
  yyp = await addSpriteFromImages(dir, yyp, "sprLintTarget", path.join(process.cwd(), "test/fixtures"));
  await writeYyp(dir, yyp);

  const cleanIssues = await lintProject(dir);
  const cleanErrors = cleanIssues.filter(i => i.severity === "error" && i.file?.includes("LintTarget"));
  ok("lint: clean, freshly-built cluster has zero errors", cleanErrors.length === 0, JSON.stringify(cleanErrors));

  // Corrupt 1: dangling reference (delete object file behind the yyp's back)
  await fs.rm(path.join(dir, "objects/objLintTarget"), { recursive: true, force: true });
  let issues = await lintProject(dir);
  ok("lint: catches dangling yyp catalog entry (file deleted behind its back)",
    issues.some(i => i.severity === "error" && i.message.includes("objLintTarget") && i.message.includes("missing")));
  ok("lint: catches the room instance left pointing at the now-deleted object",
    issues.some(i => i.severity === "error" && i.message.includes("rmLintHolder") && i.message.includes("objLintTarget")));

  // Clean up Corrupt 1 fully (not just the files) so later tests -- like the
  // ProjectTool integration below -- operate on a genuinely clean project,
  // not one still carrying this deliberate corruption forward.
  await fs.rm(path.join(dir, "rooms/rmLintHolder"), { recursive: true, force: true });
  yyp = await loadYyp(dir);
  yyp.resources = yyp.resources.filter((r: any) => !r.id?.path?.includes("objLintTarget") && !r.id?.path?.includes("rmLintHolder"));
  (yyp as any).RoomOrderNodes = ((yyp as any).RoomOrderNodes ?? []).filter((n: any) => n.roomId?.name !== "rmLintHolder");
  await writeYyp(dir, yyp);

  // Corrupt 1.5: event declared in eventList but its code file missing --
  // GameMaker loads the project fine and silently treats the event as empty,
  // which no other check can see.
  yyp = await loadYyp(dir);
  yyp = await addObject(dir, yyp, "objLintEvent", [{ eventType: 0, eventNum: 0 }]);
  await writeYyp(dir, yyp);
  await fs.rm(path.join(dir, "objects/objLintEvent/Create_0.gml"), { force: true });
  issues = await lintProject(dir);
  ok("lint: catches an event whose code file is missing",
    issues.some(i => i.severity === "error" && i.message.includes("objLintEvent") && i.message.includes("Create_0")));
  yyp = await loadYyp(dir);
  yyp = await deleteResource(dir, yyp, "objects", "objLintEvent", true);
  await writeYyp(dir, yyp);

  // Corrupt 2: orphaned directory (exists on disk, not registered)
  await fs.mkdir(path.join(dir, "objects/objOrphan"), { recursive: true });
  await fs.writeFile(path.join(dir, "objects/objOrphan/objOrphan.yy"), JSON.stringify({ name: "objOrphan" }), "utf8");
  issues = await lintProject(dir);
  ok("lint: catches an orphaned resource directory", issues.some(i => i.message.includes("objOrphan") && i.message.includes("isn't registered")));
  await fs.rm(path.join(dir, "objects/objOrphan"), { recursive: true, force: true });

  // Corrupt 3: sound metadata mismatch (the real crash-on-load bug)
  const sndYyPath = path.join(dir, "sounds/sndLintTarget/sndLintTarget.yy");
  const sndYy = JSON.parse(await fs.readFile(sndYyPath, "utf8"));
  const realSampleRate = sndYy.sampleRate;
  sndYy.sampleRate = 8000;
  await fs.writeFile(sndYyPath, JSON.stringify(sndYy, null, 2), "utf8");
  issues = await lintProject(dir);
  ok("lint: catches sound sampleRate mismatch (the real crash bug)",
    issues.some(i => i.severity === "error" && i.message.includes("sndLintTarget") && i.message.includes("sampleRate")));
  sndYy.sampleRate = realSampleRate;
  await fs.writeFile(sndYyPath, JSON.stringify(sndYy, null, 2), "utf8");

  // Corrupt 4: sprite dimension mismatch
  const sprYyPath = path.join(dir, "sprites/sprLintTarget/sprLintTarget.yy");
  const sprYy = JSON.parse(await fs.readFile(sprYyPath, "utf8"));
  const realWidth = sprYy.width;
  sprYy.width = 9999;
  await fs.writeFile(sprYyPath, JSON.stringify(sprYy, null, 2), "utf8");
  issues = await lintProject(dir);
  ok("lint: catches sprite dimension mismatch",
    issues.some(i => i.severity === "error" && i.message.includes("sprLintTarget") && i.message.includes("9999")));
  sprYy.width = realWidth;
  await fs.writeFile(sprYyPath, JSON.stringify(sprYy, null, 2), "utf8");

  // Corrupt 5: missing folder registration
  yyp = await loadYyp(dir);
  const beforeFolderRemoval = ((yyp as any).Folders ?? []).length;
  (yyp as any).Folders = ((yyp as any).Folders ?? []).filter((f: any) => f.name !== "Sounds");
  await writeYyp(dir, yyp);
  issues = await lintProject(dir);
  ok("lint: catches a resource parenting to an unregistered folder",
    issues.some(i => i.severity === "error" && i.message.includes("sndLintTarget") && i.message.includes("folder")));

  // Restore, so later tests (like the ProjectTool integration below) run
  // against a genuinely clean project again.
  yyp = await loadYyp(dir);
  const restoredYyp: any = yyp;
  if (!(restoredYyp.Folders ?? []).some((f: any) => f.name === "Sounds")) {
    restoredYyp.Folders = [...(restoredYyp.Folders ?? []), { "$GMFolder": "", "%Name": "Sounds", folderPath: "folders/Sounds.yy", name: "Sounds", resourceType: "GMFolder", resourceVersion: "2.0" }];
  }
  await writeYyp(dir, restoredYyp);

  // Not a corruption: a resource parenting directly to the project's own
  // .yyp (not a category folder) is legal GameMaker behavior and must NOT
  // be flagged as a missing-folder error (a real false positive this
  // session, found by testing lint against real Convoy).
  const sprYyForParentTest = JSON.parse(await fs.readFile(sprYyPath, "utf8"));
  sprYyForParentTest.parent = { name: "TestProj", path: "TestProj.yyp" };
  await fs.writeFile(sprYyPath, JSON.stringify(sprYyForParentTest, null, 2), "utf8");
  issues = await lintProject(dir);
  ok("lint: does NOT flag a resource parenting directly to the project (legal)",
    !issues.some(i => i.message.includes("sprLintTarget") && i.message.includes("folder")));

  // --- ProjectTool integration (GameMaker's own official headless validator) ---
  const badRoomPath = path.join(dir, "rooms/rmProjectToolCheck/rmProjectToolCheck.yy");
  if (await findProjectTool()) {
    yyp = await loadYyp(dir);
    yyp = await addRoom(dir, yyp, "rmProjectToolCheck", { width: 200, height: 200, persistent: false });
    await writeYyp(dir, yyp);

    issues = await lintProject(dir);
    ok("lint+ProjectTool: clean project reports no ProjectTool errors",
      !issues.some(i => i.message.includes("ProjectTool") && i.severity === "error"), JSON.stringify(issues.filter(i => i.message.includes("ProjectTool"))));

    // Reintroduce a real bug class: a room missing creationCodeFile
    // entirely (not empty string -- absent).
    const badRoom = JSON.parse(await fs.readFile(badRoomPath, "utf8"));
    delete badRoom.creationCodeFile;
    await fs.writeFile(badRoomPath, JSON.stringify(badRoom, null, 2), "utf8");

    issues = await lintProject(dir);
    ok("lint+ProjectTool: catches a real schema violation our own semantic checks miss",
      issues.some(i => i.severity === "error" && i.message.includes("ProjectTool") && i.message.includes("creationCodeFile")));

    // Restore, so later tests (including the Igor compile check below) run
    // against a genuinely clean project again.
    badRoom.creationCodeFile = "";
    await fs.writeFile(badRoomPath, JSON.stringify(badRoom, null, 2), "utf8");
  } else {
    skip("ProjectTool.exe not found on this machine -- real-GameMaker-validator integration untested here");
  }

  // --- Igor integration (GameMaker's own real compiler -- catches actual GML
  // compile errors, e.g. duplicate function names, that no structural check
  // above can see) ---
  if (await findIgor()) {
    let result = await compileProject(dir);
    ok("compile: clean project compiles successfully", result.success, result.message);

    // Reintroduce a real compile-error class: two functions with the same
    // name in one script.
    const scriptPath = path.join(dir, "scripts/scrTest/scrTest.gml");
    const originalScript = await fs.readFile(scriptPath, "utf8");
    await fs.writeFile(scriptPath, originalScript + "\nfunction scrTest() {\n  return 2;\n}\n", "utf8");

    result = await compileProject(dir);
    ok("compile: catches a real duplicate-function-name compile error",
      !result.success && result.errors.some(e => e.includes("duplicate script name")), result.message);

    // Restore, so this deliberate breakage doesn't affect any test after this.
    await fs.writeFile(scriptPath, originalScript, "utf8");
  } else {
    skip("Igor not found on this machine (no runtime downloaded) -- real-compile integration untested here");
  }

  // --- Notes (best-effort, no real ground truth -- flagged clearly in the code) ---
  yyp = await loadYyp(dir);
  yyp = await addNote(dir, yyp, "noteTest", "Design notes go here.");
  await writeYyp(dir, yyp);
  ok("note: file created on disk", await fileExists(path.join(dir, "notes/noteTest/noteTest.yy")));
  ok("note: content file created", await fileExists(path.join(dir, "notes/noteTest/noteTest.txt")));
  const noteYy = JSON.parse(await fs.readFile(path.join(dir, "notes/noteTest/noteTest.yy"), "utf8"));
  ok("note: resourceType is GMNotes", noteYy.resourceType === "GMNotes");
  ok("note: Notes folder registered", ((yyp as any).Folders ?? []).some((f: any) => f.folderPath === "folders/Notes.yy"));
  const noteContent = await fs.readFile(path.join(dir, "notes/noteTest/noteTest.txt"), "utf8");
  ok("note: content matches", noteContent === "Design notes go here.");
  await expectThrows("addNote: rejects invalid name", () => addNote(dir, yyp, "1BadNote"));

  // --- Regression: notes were previously a second-class resource -- creatable
  // but not deletable/renamable/listable through the generic tools. Confirm
  // all three now work the same as every other resource category. ---
  const notesListed = await (async () => {
    const y = await loadYyp(dir);
    return y.resources.filter((r: any) => r.id?.path?.startsWith("notes/")).map((r: any) => r.id.name);
  })();
  ok("list_resources: notes are listable by kind", notesListed.includes("noteTest"));

  yyp = await loadYyp(dir);
  yyp = await renameResource(dir, yyp, "notes", "noteTest", "noteRenamed");
  await writeYyp(dir, yyp);
  ok("renameResource: works on notes", await fileExists(path.join(dir, "notes/noteRenamed/noteRenamed.yy"))
    && await fileExists(path.join(dir, "notes/noteRenamed/noteRenamed.txt"))
    && !(await fileExists(path.join(dir, "notes/noteTest"))));

  yyp = await deleteResource(dir, yyp, "notes", "noteRenamed");
  await writeYyp(dir, yyp);
  ok("deleteResource: works on notes", !(await fileExists(path.join(dir, "notes/noteRenamed"))));

  // --- Room reordering ---
  yyp = await loadYyp(dir);
  yyp = await addRoom(dir, yyp, "rmOrderA", { width: 100, height: 100, persistent: false });
  await writeYyp(dir, yyp);
  yyp = await loadYyp(dir);
  yyp = await addRoom(dir, yyp, "rmOrderB", { width: 100, height: 100, persistent: false });
  await writeYyp(dir, yyp);
  yyp = await loadYyp(dir);
  yyp = await addRoom(dir, yyp, "rmOrderC", { width: 100, height: 100, persistent: false });
  await writeYyp(dir, yyp);

  yyp = await loadYyp(dir);
  const orderNames = () => ((yyp as any).RoomOrderNodes ?? []).map((n: any) => n.roomId?.name);
  const idxA = orderNames().indexOf("rmOrderA");
  yyp = reorderRoom(yyp, "rmOrderC", 0);
  ok("reorderRoom: moved to the front", orderNames()[0] === "rmOrderC");

  yyp = moveRoomRelativeTo(yyp, "rmOrderA", "rmOrderB", "after");
  const namesAfterMove = orderNames();
  ok("moveRoomRelativeTo: A now comes immediately after B",
    namesAfterMove.indexOf("rmOrderA") === namesAfterMove.indexOf("rmOrderB") + 1, JSON.stringify(namesAfterMove));
  await writeYyp(dir, yyp);

  await expectThrows("reorderRoom: rejects nonexistent room", () => reorderRoom(yyp, "rmDoesNotExist", 0));
  await expectThrows("moveRoomRelativeTo: rejects nonexistent target", () => moveRoomRelativeTo(yyp, "rmOrderA", "rmDoesNotExist", "before"));
  await expectThrows("moveRoomRelativeTo: rejects moving relative to itself", () => moveRoomRelativeTo(yyp, "rmOrderA", "rmOrderA", "before"));

  await fs.rm(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped > 0) {
    console.log(`SKIPPED (real-GameMaker checks did not run on this machine):`);
    for (const reason of skippedReasons) console.log(`  - ${reason}`);
  }
  if (failed > 0) process.exit(1);
}

main();
