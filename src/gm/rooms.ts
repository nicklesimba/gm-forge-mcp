import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, validateResourceName, parseGameMakerJson, assertSafeResourceName, RESOURCE_VERSIONS, registerResource } from "./yyp.js";

export interface RoomOptions {
  width: number;
  height: number;
  persistent: boolean;
  creationCode?: string;
}

const DEFAULT_VIEW = {
  hborder: 32,
  hport: 360,
  hspeed: -1,
  hview: 360,
  inherit: false,
  objectId: null,
  vborder: 32,
  visible: false,
  vspeed: -1,
  wport: 640,
  wview: 640,
  xport: 0,
  xview: 0,
  yport: 0,
  yview: 0
};

export async function addRoom(
  projectDir: string,
  yyp: Yyp,
  roomName: string,
  options: RoomOptions
): Promise<Yyp> {
  validateResourceName(yyp, roomName);

  const dir = path.join(projectDir, "rooms", roomName);
  await fs.mkdir(dir, { recursive: true });

  const hasCreationCode = options.creationCode !== undefined && options.creationCode.length > 0;
  if (hasCreationCode) {
    await fs.writeFile(path.join(dir, "RoomCreationCode.gml"), options.creationCode!, "utf8");
  }

  const view = {
    ...DEFAULT_VIEW,
    hport: options.height,
    hview: options.height,
    wport: options.width,
    wview: options.width
  };

  const roomYy = {
    $GMRoom: "v1",
    "%Name": roomName,
    creationCodeFile: hasCreationCode ? `rooms/${roomName}/RoomCreationCode.gml` : "",
    inheritCode: false,
    inheritCreationOrder: false,
    inheritLayers: false,
    instanceCreationOrder: [],
    isDnd: false,
    layers: [
      {
        $GMRInstanceLayer: "",
        "%Name": "Instances",
        depth: 0,
        effectEnabled: true,
        effectType: null,
        gridX: 16,
        gridY: 16,
        hierarchyFrozen: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        instances: [],
        layers: [],
        name: "Instances",
        properties: [],
        resourceType: "GMRInstanceLayer",
        resourceVersion: RESOURCE_VERSIONS.roomInstanceLayer,
        userdefinedDepth: false,
        visible: true
      },
      {
        $GMRBackgroundLayer: "",
        "%Name": "Background",
        animationFPS: 15.0,
        animationSpeedType: 0,
        colour: 4278190080,
        depth: 100,
        effectEnabled: true,
        effectType: null,
        gridX: 16,
        gridY: 16,
        hierarchyFrozen: false,
        hspeed: 0.0,
        htiled: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        layers: [],
        name: "Background",
        properties: [],
        resourceType: "GMRBackgroundLayer",
        resourceVersion: RESOURCE_VERSIONS.roomBackgroundLayer,
        spriteId: null,
        stretch: false,
        userdefinedAnimFPS: false,
        userdefinedDepth: false,
        visible: true,
        vspeed: 0.0,
        vtiled: false,
        x: 0,
        y: 0
      }
    ],
    name: roomName,
    parent: {
      name: "Rooms",
      path: "folders/Rooms.yy"
    },
    parentRoom: null,
    physicsSettings: {
      inheritPhysicsSettings: false,
      PhysicsWorld: false,
      PhysicsWorldGravityX: 0.0,
      PhysicsWorldGravityY: 10.0,
      PhysicsWorldPixToMetres: 0.1
    },
    resourceType: "GMRoom",
    resourceVersion: RESOURCE_VERSIONS.room,
    roomSettings: {
      Height: options.height,
      inheritRoomSettings: false,
      persistent: options.persistent,
      Width: options.width
    },
    sequenceId: null,
    views: Array(8).fill(view),
    viewSettings: {
      clearDisplayBuffer: true,
      clearViewBackground: false,
      enableViews: false,
      inheritViewSettings: false
    },
    volume: 1.0
  };

  await fs.writeFile(
    path.join(dir, `${roomName}.yy`),
    JSON.stringify(roomYy, null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Rooms");

  const resourcePath = `rooms/${roomName}/${roomName}.yy`;
  const roomId = { name: roomName, path: resourcePath };

  registerResource(yyp, roomName, resourcePath);

  const orderNodes = (yyp as any).RoomOrderNodes ?? [];
  const inOrder = orderNodes.some((n: any) => n.roomId?.path === resourcePath);
  if (!inOrder) {
    orderNodes.push({ roomId });
    (yyp as any).RoomOrderNodes = orderNodes;
  }

  return yyp;
}

export interface RoomEditOptions {
  width?: number;
  height?: number;
  persistent?: boolean;
}

/**
 * Edit an existing room's dimensions and/or persistence. Only touches the
 * room's own .yy -- no YYP changes, since nothing about its registration
 * changes.
 */
export async function editRoom(
  projectDir: string,
  roomName: string,
  options: RoomEditOptions
): Promise<void> {
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

  if (options.width !== undefined) {
    room.roomSettings.Width = options.width;
    for (const view of room.views) {
      view.wport = options.width;
      view.wview = options.width;
    }
  }
  if (options.height !== undefined) {
    room.roomSettings.Height = options.height;
    for (const view of room.views) {
      view.hport = options.height;
      view.hview = options.height;
    }
  }
  if (options.persistent !== undefined) {
    room.roomSettings.persistent = options.persistent;
  }

  await fs.writeFile(roomYyPath, JSON.stringify(room, null, 2), "utf8");
}

function getRoomOrderNodes(yyp: Yyp): any[] {
  return ((yyp as any).RoomOrderNodes ?? []) as any[];
}

function findRoomOrderIndex(nodes: any[], roomName: string): number {
  return nodes.findIndex(n => n.roomId?.name === roomName);
}

/**
 * Move a room to an absolute position (0-based) in the game's room order
 * (RoomOrderNodes -- this is the order rooms load in, and what
 * room_goto_next/room_goto_previous follow at runtime).
 */
export function reorderRoom(yyp: Yyp, roomName: string, newIndex: number): Yyp {
  const nodes = getRoomOrderNodes(yyp);
  const currentIndex = findRoomOrderIndex(nodes, roomName);
  if (currentIndex === -1) {
    throw new Error(`Room "${roomName}" is not in the room order (does it exist?)`);
  }
  const clampedIndex = Math.max(0, Math.min(newIndex, nodes.length - 1));
  const [node] = nodes.splice(currentIndex, 1);
  nodes.splice(clampedIndex, 0, node);
  (yyp as any).RoomOrderNodes = nodes;
  return yyp;
}

/**
 * Move a room immediately before or after another named room in the room
 * order -- more natural for a request like "put the tutorial room right
 * before level 1" than computing raw indices.
 */
export function moveRoomRelativeTo(yyp: Yyp, roomName: string, targetRoomName: string, position: "before" | "after"): Yyp {
  const nodes = getRoomOrderNodes(yyp);
  const targetIndex = findRoomOrderIndex(nodes, targetRoomName);
  if (targetIndex === -1) {
    throw new Error(`Target room "${targetRoomName}" is not in the room order (does it exist?)`);
  }
  if (roomName === targetRoomName) {
    throw new Error(`Cannot move "${roomName}" relative to itself`);
  }
  const currentIndex = findRoomOrderIndex(nodes, roomName);
  if (currentIndex === -1) {
    throw new Error(`Room "${roomName}" is not in the room order (does it exist?)`);
  }

  const [node] = nodes.splice(currentIndex, 1);
  // Re-find the target's index since removal may have shifted it
  const adjustedTargetIndex = findRoomOrderIndex(nodes, targetRoomName);
  const insertIndex = position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nodes.splice(insertIndex, 0, node);
  (yyp as any).RoomOrderNodes = nodes;
  return yyp;
}
