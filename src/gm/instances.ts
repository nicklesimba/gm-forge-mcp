import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { parseGameMakerJson, assertSafeResourceName, RESOURCE_VERSIONS, fileExists } from "./yyp.js";

export interface InstanceOptions {
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

function randomInstanceName(): string {
  return `inst_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Place an instance of an existing object into an existing room, at the
 * given position. Both the room and object must already exist -- this only
 * mutates the room's own .yy file (Instances layer + instanceCreationOrder),
 * no .yyp changes needed since no new top-level resource is being created.
 */
export async function addRoomInstance(
  projectDir: string,
  roomName: string,
  objectName: string,
  x: number,
  y: number,
  options: InstanceOptions = {}
): Promise<{ instanceName: string }> {
  assertSafeResourceName(roomName);
  assertSafeResourceName(objectName);
  const roomYyPath = path.join(projectDir, "rooms", roomName, `${roomName}.yy`);
  if (!(await fileExists(roomYyPath))) {
    throw new Error(`Room "${roomName}" does not exist (expected ${roomYyPath})`);
  }

  const objectYyPath = path.join(projectDir, "objects", objectName, `${objectName}.yy`);
  if (!(await fileExists(objectYyPath))) {
    throw new Error(`Object "${objectName}" does not exist (expected ${objectYyPath})`);
  }

  const room = parseGameMakerJson(await fs.readFile(roomYyPath, "utf8"));
  const instanceLayer = room.layers.find((l: any) => l.resourceType === "GMRInstanceLayer");
  if (!instanceLayer) {
    throw new Error(`Room "${roomName}" has no Instances layer to place into`);
  }

  const instanceName = randomInstanceName();
  const instance = {
    "$GMRInstance": "v4",
    "%Name": instanceName,
    colour: 4294967295,
    frozen: false,
    hasCreationCode: false,
    ignore: false,
    imageIndex: 0,
    imageSpeed: 1.0,
    inheritCode: false,
    inheritedItemId: null,
    inheritItemSettings: false,
    isDnd: false,
    name: instanceName,
    objectId: {
      name: objectName,
      path: `objects/${objectName}/${objectName}.yy`
    },
    properties: [],
    resourceType: "GMRInstance",
    resourceVersion: RESOURCE_VERSIONS.roomInstance,
    rotation: options.rotation ?? 0.0,
    scaleX: options.scaleX ?? 1.0,
    scaleY: options.scaleY ?? 1.0,
    x,
    y
  };

  instanceLayer.instances.push(instance);
  room.instanceCreationOrder.push({
    name: instanceName,
    path: `rooms/${roomName}/${roomName}.yy`
  });

  await fs.writeFile(roomYyPath, JSON.stringify(room, null, 2), "utf8");

  return { instanceName };
}
