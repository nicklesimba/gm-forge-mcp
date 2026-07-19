import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import type { EventDefinition } from "./types.js";
import { ensureFolder, registerResource, validateResourceName, parseGameMakerJson, assertSafeResourceName, RESOURCE_VERSIONS, fileExists } from "./yyp.js";

interface ObjectFiles {
  dir: string;
  yyFile: string;
  catalogPath: string;
}

function objectFiles(projectDir: string, name: string): ObjectFiles {
  const dir = path.join(projectDir, "objects", name);
  return { dir, yyFile: path.join(dir, `${name}.yy`), catalogPath: `objects/${name}/${name}.yy` };
}

function eventFileName(objectName: string, event: EventDefinition): string {
  return `${objectName}_${event.eventType}_${event.eventNum}.gml`;
}

/**
 * Resolves a Collision event's target into a real {name,path} reference,
 * verified against an object that actually exists -- collisionObjectId
 * being wrong or dangling means GameMaker can't resolve the collision at
 * runtime.
 */
async function resolveCollisionTarget(projectDir: string, event: EventDefinition): Promise<{ name: string; path: string } | null> {
  if (!event.collisionTargetName) return null;
  assertSafeResourceName(event.collisionTargetName);
  const targetYyFile = objectFiles(projectDir, event.collisionTargetName).yyFile;
  if (!(await fileExists(targetYyFile))) {
    throw new Error(`Collision target object "${event.collisionTargetName}" does not exist (expected ${targetYyFile})`);
  }
  return { name: event.collisionTargetName, path: `objects/${event.collisionTargetName}/${event.collisionTargetName}.yy` };
}

function eventEntry(event: EventDefinition, collisionObjectId: { name: string; path: string } | null = null) {
  return {
    isDnD: false,
    eventType: event.eventType,
    eventNum: event.eventNum,
    collisionObjectId,
    name: "",
    resourceType: "GMEvent",
    resourceVersion: RESOURCE_VERSIONS.event,
    "$GMEvent": "v1",
    "%Name": ""
  };
}

// A freshly-placed object with no physics behavior configured -- matches
// what GameMaker's own "New Object" flow produces before physics is enabled.
const NO_PHYSICS = {
  physicsObject: false,
  physicsSensor: false,
  physicsShape: 1,
  physicsGroup: 1,
  physicsDensity: 0.5,
  physicsRestitution: 0.1,
  physicsLinearDamping: 0.1,
  physicsAngularDamping: 0.1,
  physicsFriction: 0.2,
  physicsStartAwake: true,
  physicsKinematic: false,
  physicsShapePoints: [] as any[]
};

function newObjectYy(name: string, eventList: ReturnType<typeof eventEntry>[]) {
  return {
    name,
    spriteId: null,
    spriteMaskId: null,
    parentObjectId: null,
    solid: false,
    visible: true,
    managed: true,
    persistent: false,
    ...NO_PHYSICS,
    eventList,
    properties: [],
    overriddenProperties: [],
    parent: { name: "Objects", path: "folders/Objects.yy" },
    resourceType: "GMObject",
    resourceVersion: RESOURCE_VERSIONS.object,
    "$GMObject": "",
    "%Name": name
  };
}

export async function addObject(projectDir: string, yyp: Yyp, name: string, events: EventDefinition[]): Promise<Yyp> {
  validateResourceName(yyp, name);
  const files = objectFiles(projectDir, name);

  const eventList = [];
  for (const event of events) {
    eventList.push(eventEntry(event, await resolveCollisionTarget(projectDir, event)));
  }

  await fs.mkdir(files.dir, { recursive: true });
  await fs.writeFile(files.yyFile, JSON.stringify(newObjectYy(name, eventList), null, 2), "utf8");
  for (const event of events) {
    await fs.writeFile(path.join(files.dir, eventFileName(name, event)), "// Event code here\n", "utf8");
  }

  ensureFolder(yyp, "Objects");
  registerResource(yyp, name, files.catalogPath);

  return yyp;
}

async function readObjectYy(yyFile: string, name: string): Promise<any> {
  try {
    return parseGameMakerJson(await fs.readFile(yyFile, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Object "${name}" does not exist (expected ${yyFile})`);
    }
    throw new Error(`Failed to read object "${name}" at ${yyFile}: ${e.message}`);
  }
}

/**
 * Only touches the object's own .yy (appends to eventList) and writes the
 * event's stub .gml -- no catalog change, since no new top-level resource
 * is created.
 */
export async function addObjectEvent(
  projectDir: string,
  name: string,
  event: EventDefinition,
  code: string = "// Event code here\n"
): Promise<void> {
  assertSafeResourceName(name);
  const files = objectFiles(projectDir, name);
  const obj = await readObjectYy(files.yyFile, name);

  const duplicate = obj.eventList.some((e: any) => e.eventType === event.eventType && e.eventNum === event.eventNum);
  if (duplicate) {
    throw new Error(`Object "${name}" already has an event with type ${event.eventType}, num ${event.eventNum}`);
  }

  obj.eventList.push(eventEntry(event, await resolveCollisionTarget(projectDir, event)));
  await fs.writeFile(files.yyFile, JSON.stringify(obj, null, 2), "utf8");
  await fs.writeFile(path.join(files.dir, eventFileName(name, event)), code, "utf8");
}
