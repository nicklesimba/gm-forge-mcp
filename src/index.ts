#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  loadYyp,
  writeYyp,
  ensureProjectScaffold,
  withProjectLock,
  addTextureGroup,
  addAudioGroup,
} from "./gm/yyp.js";
import { addScript, editScript } from "./gm/scripts.js";
import { addObject, addObjectEvent } from "./gm/objects.js";
import { addSpriteFromImages, editSprite } from "./gm/sprites.js";
import { addRoom, editRoom, reorderRoom, moveRoomRelativeTo } from "./gm/rooms.js";
import { addRoomInstance } from "./gm/instances.js";
import { addShader, editShader } from "./gm/shaders.js";
import { addSound, editSound } from "./gm/sounds.js";
import { addFont, editFont } from "./gm/fonts.js";
import { addNote } from "./gm/notes.js";
import { addTileset, editTileset } from "./gm/tilesets.js";
import { addExtension } from "./gm/extensions.js";
import { addParticleSystem } from "./gm/particle_systems.js";
import { addAnimCurve } from "./gm/animation_curves.js";
import { getObjectInfo, getRoomInfo, getSpriteInfo, getScriptInfo, getShaderInfo, getSoundInfo, getFontInfo, getNoteInfo, getTilesetInfo, getExtensionInfo, getParticleSystemInfo, getAnimCurveInfo } from "./gm/introspect.js";
import { findReferences } from "./gm/references.js";
import { deleteResource, ResourceInUseError } from "./gm/delete.js";
import { renameResource } from "./gm/rename.js";
import { lintProject } from "./gm/lint.js";
import { compileProject } from "./gm/build.js";

// Schema definitions
const EVENT_TYPE_DESCRIPTION =
  "GameMaker event type number: 0=Create, 1=Destroy, 2=Alarm, 3=Step, 4=Collision, 5=Keyboard, " +
  "6=Mouse, 7=Other, 8=Draw, 9=KeyPress, 10=KeyRelease, 11=Trigger, 12=CleanUp, 13=Gesture";
const EVENT_NUM_DESCRIPTION =
  "Sub-number within the event type -- meaning depends on eventType. For most types (Create, " +
  "Destroy, Draw) this is 0. For Alarm: which alarm, 0-11. For Step: 0=Step, 1=Begin Step, " +
  "2=End Step. For Collision: use 0 -- set collisionTargetName separately to specify the other " +
  "object. For Keyboard/KeyPress/KeyRelease: a virtual key code (e.g. vk_space=32, ord('A')=65).";

const ProjectSchema = z.object({
  projectDir: z.string().describe("Absolute path to the GameMaker project directory"),
});

const CreateProjectSchema = ProjectSchema.extend({
  name: z.string().describe("Project name for the YYP"),
});

const AddTextureGroupSchema = ProjectSchema.extend({
  groupName: z.string().describe("Name of the new texture group to create"),
});

const AddAudioGroupSchema = ProjectSchema.extend({
  groupName: z.string().describe("Name of the new audio group to create"),
});

const AddScriptSchema = ProjectSchema.extend({
  scriptName: z.string().describe("Name of the script to create"),
  code: z.string().default("// TODO").describe("GML code for the script"),
});

const AddObjectSchema = ProjectSchema.extend({
  objectName: z.string().describe("Name of the object to create"),
  events: z
    .array(
      z.object({
        eventType: z.number().describe(EVENT_TYPE_DESCRIPTION),
        eventNum: z.number().describe(EVENT_NUM_DESCRIPTION),
        collisionTargetName: z.string().optional().describe("For Collision events (eventType 4) only: name of the existing object this collides with"),
      })
    )
    .default([])
    .describe("Array of event definitions to create"),
});

const AddSpriteSchema = ProjectSchema.extend({
  spriteName: z.string().describe("Name of the sprite to create"),
  framesDir: z.string().describe("Directory containing PNG frames"),
});

const AddRoomSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the room to create"),
  width: z.number().int().positive().default(1366).describe("Room width in pixels"),
  height: z.number().int().positive().default(768).describe("Room height in pixels"),
  persistent: z.boolean().default(false).describe("Whether the room is persistent"),
  creationCode: z.string().optional().describe("GML room creation code"),
});

const EditScriptSchema = ProjectSchema.extend({
  scriptName: z.string().describe("Name of the existing script to edit"),
  code: z.string().describe("GML code to write"),
  mode: z.enum(["replace", "append"]).default("append").describe("replace overwrites the whole file; append adds to the end"),
});

const AddObjectEventSchema = ProjectSchema.extend({
  objectName: z.string().describe("Name of the existing object to add an event to"),
  eventType: z.number().describe(EVENT_TYPE_DESCRIPTION),
  eventNum: z.number().describe(EVENT_NUM_DESCRIPTION),
  collisionTargetName: z.string().optional().describe("For Collision events (eventType 4) only: name of the existing object this collides with"),
  code: z.string().default("// Event code here\n").describe("GML code for the new event"),
});

const EditRoomSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the existing room to edit"),
  width: z.number().int().positive().optional().describe("New room width in pixels"),
  height: z.number().int().positive().optional().describe("New room height in pixels"),
  persistent: z.boolean().optional().describe("New persistent flag"),
});

const ReorderRoomSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the room to move"),
  newIndex: z.number().int().min(0).describe("New 0-based position in the room order"),
});

const MoveRoomRelativeSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the room to move"),
  targetRoomName: z.string().describe("Room to position it relative to"),
  position: z.enum(["before", "after"]).describe("Whether to place it before or after the target room"),
});

const AddNoteSchema = ProjectSchema.extend({
  noteName: z.string().describe("Name of the note to create"),
  content: z.string().default("").describe("Plain-text content of the note"),
});

const GetNoteInfoSchema = ProjectSchema.extend({
  noteName: z.string().describe("Name of the note to inspect"),
});

const AddRoomInstanceSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the existing room to place the instance into"),
  objectName: z.string().describe("Name of the existing object to place"),
  x: z.number().describe("X position in the room"),
  y: z.number().describe("Y position in the room"),
  rotation: z.number().default(0).describe("Instance rotation in degrees"),
  scaleX: z.number().default(1.0).describe("Horizontal scale"),
  scaleY: z.number().default(1.0).describe("Vertical scale"),
});

const GetObjectInfoSchema = ProjectSchema.extend({
  objectName: z.string().describe("Name of the object to inspect"),
});

const GetRoomInfoSchema = ProjectSchema.extend({
  roomName: z.string().describe("Name of the room to inspect"),
});

const GetSpriteInfoSchema = ProjectSchema.extend({
  spriteName: z.string().describe("Name of the sprite to inspect"),
});

const EditSpriteSchema = ProjectSchema.extend({
  spriteName: z.string().describe("Name of the existing sprite to edit"),
  xorigin: z.number().optional().describe("New origin X coordinate in pixels (also sets the origin preset to Custom)"),
  yorigin: z.number().optional().describe("New origin Y coordinate in pixels (also sets the origin preset to Custom)"),
  collisionKind: z.number().int().optional().describe("New collision mask kind (0=Precise, 1=Rectangle, 2=Ellipse, 3=Diamond, ...)"),
  bboxMode: z.number().int().optional().describe("New bounding box mode (0=Automatic, 1=Full Image, 2=Manual)"),
  bbox_left: z.number().optional().describe("New bounding box left edge (used when bboxMode=2)"),
  bbox_top: z.number().optional().describe("New bounding box top edge (used when bboxMode=2)"),
  bbox_right: z.number().optional().describe("New bounding box right edge (used when bboxMode=2)"),
  bbox_bottom: z.number().optional().describe("New bounding box bottom edge (used when bboxMode=2)"),
});

const GetScriptInfoSchema = ProjectSchema.extend({
  scriptName: z.string().describe("Name of the script to inspect"),
});

const AddShaderSchema = ProjectSchema.extend({
  shaderName: z.string().describe("Name of the shader to create"),
  vertexCode: z.string().optional().describe("Vertex shader GLSL ES code (defaults to a passthrough shader)"),
  fragmentCode: z.string().optional().describe("Fragment shader GLSL ES code (defaults to a passthrough shader)"),
});

const GetShaderInfoSchema = ProjectSchema.extend({
  shaderName: z.string().describe("Name of the shader to inspect"),
});

const EditShaderSchema = ProjectSchema.extend({
  shaderName: z.string().describe("Name of the existing shader to edit"),
  vertexCode: z.string().optional().describe("New vertex shader GLSL ES code"),
  fragmentCode: z.string().optional().describe("New fragment shader GLSL ES code"),
});

const AddSoundSchema = ProjectSchema.extend({
  soundName: z.string().describe("Name of the sound to create"),
  sourceFile: z.string().describe("Absolute path to a .wav, .ogg, or .mp3 file to import"),
  volume: z.number().min(0).max(1).default(1.0).describe("Playback volume (0-1)"),
  preload: z.boolean().default(true).describe("Whether to preload the sound"),
});

const GetSoundInfoSchema = ProjectSchema.extend({
  soundName: z.string().describe("Name of the sound to inspect"),
});

const EditSoundSchema = ProjectSchema.extend({
  soundName: z.string().describe("Name of the existing sound to edit"),
  volume: z.number().min(0).max(1).optional().describe("New playback volume (0-1)"),
  preload: z.boolean().optional().describe("New preload flag"),
});

const AddFontSchema = ProjectSchema.extend({
  fontName: z.string().describe("Name of the font to create"),
  systemFontName: z.string().describe("Name of an installed system font (e.g. \"Arial\")"),
  size: z.number().positive().default(12).describe("Font size in points"),
  bold: z.boolean().default(false).describe("Bold style"),
  italic: z.boolean().default(false).describe("Italic style"),
});

const GetFontInfoSchema = ProjectSchema.extend({
  fontName: z.string().describe("Name of the font to inspect"),
});

const EditFontSchema = ProjectSchema.extend({
  fontName: z.string().describe("Name of the existing font to edit"),
  systemFontName: z.string().optional().describe("New installed system font name"),
  size: z.number().positive().optional().describe("New font size in points"),
  bold: z.boolean().optional().describe("New bold style"),
  italic: z.boolean().optional().describe("New italic style"),
});

const AddTilesetSchema = ProjectSchema.extend({
  tilesetName: z.string().describe("Name of the tile set to create"),
  spriteName: z.string().describe("Name of an existing sprite to use as the tile source image (add one first with add_sprite_from_images)"),
  tileWidth: z.number().int().positive().describe("Width of one tile in pixels"),
  tileHeight: z.number().int().positive().describe("Height of one tile in pixels"),
  tilehsep: z.number().int().nonnegative().default(0).describe("Horizontal spacing between tiles in the source sprite, in pixels"),
  tilevsep: z.number().int().nonnegative().default(0).describe("Vertical spacing between tiles in the source sprite, in pixels"),
  tilexoff: z.number().int().nonnegative().default(0).describe("Horizontal offset from the left edge of the source sprite before the first tile, in pixels"),
  tileyoff: z.number().int().nonnegative().default(0).describe("Vertical offset from the top edge of the source sprite before the first tile, in pixels"),
});

const GetTilesetInfoSchema = ProjectSchema.extend({
  tilesetName: z.string().describe("Name of the tile set to inspect"),
});

const EditTilesetSchema = ProjectSchema.extend({
  tilesetName: z.string().describe("Name of the existing tile set to edit"),
  tileWidth: z.number().int().positive().optional().describe("New tile width in pixels"),
  tileHeight: z.number().int().positive().optional().describe("New tile height in pixels"),
  tilehsep: z.number().int().nonnegative().optional().describe("New horizontal spacing between tiles, in pixels"),
  tilevsep: z.number().int().nonnegative().optional().describe("New vertical spacing between tiles, in pixels"),
  tilexoff: z.number().int().nonnegative().optional().describe("New horizontal offset before the first tile, in pixels"),
  tileyoff: z.number().int().nonnegative().optional().describe("New vertical offset before the first tile, in pixels"),
});

const AddExtensionSchema = ProjectSchema.extend({
  extensionName: z.string().describe("Name of the extension to create"),
});

const GetExtensionInfoSchema = ProjectSchema.extend({
  extensionName: z.string().describe("Name of the extension to inspect"),
});

const AddParticleSystemSchema = ProjectSchema.extend({
  particleSystemName: z.string().describe("Name of the particle system to create"),
});

const GetParticleSystemInfoSchema = ProjectSchema.extend({
  particleSystemName: z.string().describe("Name of the particle system to inspect"),
});

const AddAnimCurveSchema = ProjectSchema.extend({
  animCurveName: z.string().describe("Name of the animation curve to create"),
});

const GetAnimCurveInfoSchema = ProjectSchema.extend({
  animCurveName: z.string().describe("Name of the animation curve to inspect"),
});

const ResourceCategoryEnum = z.enum(["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"]);

const FindReferencesSchema = ProjectSchema.extend({
  resourceName: z.string().min(1, "resourceName cannot be empty").describe("Name of the resource to search for references to"),
});

const DeleteResourceSchema = ProjectSchema.extend({
  category: ResourceCategoryEnum.describe("Resource category (rooms/objects/scripts/sprites/shaders/sounds/fonts/notes/tilesets/extensions/particles/animcurves)"),
  resourceName: z.string().describe("Name of the resource to delete"),
  force: z.boolean().default(false).describe("Delete even if still referenced elsewhere in the project"),
});

const RenameResourceSchema = ProjectSchema.extend({
  category: ResourceCategoryEnum.describe("Resource category (rooms/objects/scripts/sprites/shaders/sounds/fonts/notes/tilesets/extensions/particles/animcurves)"),
  oldName: z.string().describe("Current name of the resource"),
  newName: z.string().describe("New name for the resource"),
});

const ListResourcesSchema = ProjectSchema.extend({
  kind: z
    .enum(["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"])
    .optional()
    .describe("Type of resources to list (optional)"),
});

// Create MCP server instance
const server = new Server(
  {
    name: "gm-forge-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "create_project",
    description: "Create a new GameMaker YYP project at the specified directory if it does not exist",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        name: {
          type: "string",
          description: "Project name for the YYP",
        },
      },
      required: ["projectDir", "name"],
    },
  },
  {
    name: "add_texture_group",
    description: "Create a new, additional texture group in the project (beyond the default one auto-provisioned for sprites/fonts)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        groupName: { type: "string", description: "Name of the new texture group to create" },
      },
      required: ["projectDir", "groupName"],
    },
  },
  {
    name: "add_audio_group",
    description: "Create a new, additional audio group in the project (beyond the default one auto-provisioned for sounds)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        groupName: { type: "string", description: "Name of the new audio group to create" },
      },
      required: ["projectDir", "groupName"],
    },
  },
  {
    name: "add_script",
    description: "Create a new GML script and register it in the YYP",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        scriptName: {
          type: "string",
          description: "Name of the script to create",
        },
        code: {
          type: "string",
          description: "GML code for the script",
          default: "// TODO",
        },
      },
      required: ["projectDir", "scriptName"],
    },
  },
  {
    name: "edit_script",
    description: "Edit an existing script's GML code, either replacing it entirely or appending to it",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        scriptName: {
          type: "string",
          description: "Name of the existing script to edit",
        },
        code: {
          type: "string",
          description: "GML code to write",
        },
        mode: {
          type: "string",
          enum: ["replace", "append"],
          description: "replace overwrites the whole file; append adds to the end",
          default: "append",
        },
      },
      required: ["projectDir", "scriptName", "code"],
    },
  },
  {
    name: "add_object",
    description: "Create a GameMaker object .yy file with optional event stubs and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        objectName: {
          type: "string",
          description: "Name of the object to create",
        },
        events: {
          type: "array",
          description: "Array of event definitions to create",
          items: {
            type: "object",
            properties: {
              eventType: {
                type: "number",
                description: EVENT_TYPE_DESCRIPTION,
              },
              eventNum: {
                type: "number",
                description: EVENT_NUM_DESCRIPTION,
              },
              collisionTargetName: {
                type: "string",
                description: "For Collision events (eventType 4) only: name of the existing object this collides with",
              },
            },
            required: ["eventType", "eventNum"],
          },
          default: [],
        },
      },
      required: ["projectDir", "objectName"],
    },
  },
  {
    name: "add_object_event",
    description: "Add a new event to an existing object, with its own GML code",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        objectName: {
          type: "string",
          description: "Name of the existing object to add an event to",
        },
        eventType: {
          type: "number",
          description: EVENT_TYPE_DESCRIPTION,
        },
        eventNum: {
          type: "number",
          description: EVENT_NUM_DESCRIPTION,
        },
        collisionTargetName: {
          type: "string",
          description: "For Collision events (eventType 4) only: name of the existing object this collides with",
        },
        code: {
          type: "string",
          description: "GML code for the new event",
          default: "// Event code here\n",
        },
      },
      required: ["projectDir", "objectName", "eventType", "eventNum"],
    },
  },
  {
    name: "add_sprite_from_images",
    description: "Import frames from a directory into a new sprite and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        spriteName: {
          type: "string",
          description: "Name of the sprite to create",
        },
        framesDir: {
          type: "string",
          description: "Directory containing PNG frames",
        },
      },
      required: ["projectDir", "spriteName", "framesDir"],
    },
  },
  {
    name: "add_room",
    description: "Create a GameMaker room with default instance and background layers, register it in the project and room order",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        roomName: {
          type: "string",
          description: "Name of the room to create",
        },
        width: {
          type: "number",
          description: "Room width in pixels",
          default: 1366,
        },
        height: {
          type: "number",
          description: "Room height in pixels",
          default: 768,
        },
        persistent: {
          type: "boolean",
          description: "Whether the room is persistent",
          default: false,
        },
        creationCode: {
          type: "string",
          description: "GML room creation code",
        },
      },
      required: ["projectDir", "roomName"],
    },
  },
  {
    name: "edit_room",
    description: "Edit an existing room's width, height, and/or persistent flag",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        roomName: {
          type: "string",
          description: "Name of the existing room to edit",
        },
        width: {
          type: "number",
          description: "New room width in pixels",
        },
        height: {
          type: "number",
          description: "New room height in pixels",
        },
        persistent: {
          type: "boolean",
          description: "New persistent flag",
        },
      },
      required: ["projectDir", "roomName"],
    },
  },
  {
    name: "add_room_instance",
    description: "Place an instance of an existing object into an existing room at a given position",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        roomName: {
          type: "string",
          description: "Name of the existing room to place the instance into",
        },
        objectName: {
          type: "string",
          description: "Name of the existing object to place",
        },
        x: {
          type: "number",
          description: "X position in the room",
        },
        y: {
          type: "number",
          description: "Y position in the room",
        },
        rotation: {
          type: "number",
          description: "Instance rotation in degrees",
          default: 0,
        },
        scaleX: {
          type: "number",
          description: "Horizontal scale",
          default: 1.0,
        },
        scaleY: {
          type: "number",
          description: "Vertical scale",
          default: 1.0,
        },
      },
      required: ["projectDir", "roomName", "objectName", "x", "y"],
    },
  },
  {
    name: "reorder_room",
    description: "Move a room to an absolute position in the game's room order (what room_goto_next/previous follow at runtime)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        roomName: { type: "string", description: "Name of the room to move" },
        newIndex: { type: "number", description: "New 0-based position in the room order" },
      },
      required: ["projectDir", "roomName", "newIndex"],
    },
  },
  {
    name: "move_room_relative",
    description: "Move a room immediately before or after another named room in the room order",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        roomName: { type: "string", description: "Name of the room to move" },
        targetRoomName: { type: "string", description: "Room to position it relative to" },
        position: { type: "string", enum: ["before", "after"], description: "Whether to place it before or after the target room" },
      },
      required: ["projectDir", "roomName", "targetRoomName", "position"],
    },
  },
  {
    name: "add_note",
    description: "Create a new Notes resource (plain-text project documentation, never compiled into the game) and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        noteName: { type: "string", description: "Name of the note to create" },
        content: { type: "string", description: "Plain-text content of the note", default: "" },
      },
      required: ["projectDir", "noteName"],
    },
  },
  {
    name: "get_note_info",
    description: "Get an existing note's content",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        noteName: { type: "string", description: "Name of the note to inspect" },
      },
      required: ["projectDir", "noteName"],
    },
  },
  {
    name: "get_object_info",
    description: "Get detailed info about an existing object: sprite, parent, physics, and its full event list with human-readable event names",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        objectName: { type: "string", description: "Name of the object to inspect" },
      },
      required: ["projectDir", "objectName"],
    },
  },
  {
    name: "get_room_info",
    description: "Get detailed info about an existing room: dimensions, persistence, layers, and every placed instance with its position",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        roomName: { type: "string", description: "Name of the room to inspect" },
      },
      required: ["projectDir", "roomName"],
    },
  },
  {
    name: "get_sprite_info",
    description: "Get detailed info about an existing sprite: real dimensions, frame count, origin, collision settings",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        spriteName: { type: "string", description: "Name of the sprite to inspect" },
      },
      required: ["projectDir", "spriteName"],
    },
  },
  {
    name: "edit_sprite",
    description: "Edit an existing sprite's origin, collision kind, and/or bounding box -- not its frame data",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        spriteName: { type: "string", description: "Name of the existing sprite to edit" },
        xorigin: { type: "number", description: "New origin X coordinate in pixels (also sets the origin preset to Custom)" },
        yorigin: { type: "number", description: "New origin Y coordinate in pixels (also sets the origin preset to Custom)" },
        collisionKind: { type: "number", description: "New collision mask kind (0=Precise, 1=Rectangle, 2=Ellipse, 3=Diamond, ...)" },
        bboxMode: { type: "number", description: "New bounding box mode (0=Automatic, 1=Full Image, 2=Manual)" },
        bbox_left: { type: "number", description: "New bounding box left edge (used when bboxMode=2)" },
        bbox_top: { type: "number", description: "New bounding box top edge (used when bboxMode=2)" },
        bbox_right: { type: "number", description: "New bounding box right edge (used when bboxMode=2)" },
        bbox_bottom: { type: "number", description: "New bounding box bottom edge (used when bboxMode=2)" },
      },
      required: ["projectDir", "spriteName"],
    },
  },
  {
    name: "get_script_info",
    description: "Get an existing script's current GML code",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        scriptName: { type: "string", description: "Name of the script to inspect" },
      },
      required: ["projectDir", "scriptName"],
    },
  },
  {
    name: "add_shader",
    description: "Create a new vertex+fragment shader pair (GLSL ES) and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        shaderName: { type: "string", description: "Name of the shader to create" },
        vertexCode: { type: "string", description: "Vertex shader GLSL ES code (defaults to a passthrough shader)" },
        fragmentCode: { type: "string", description: "Fragment shader GLSL ES code (defaults to a passthrough shader)" },
      },
      required: ["projectDir", "shaderName"],
    },
  },
  {
    name: "get_shader_info",
    description: "Get an existing shader's vertex and fragment code",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        shaderName: { type: "string", description: "Name of the shader to inspect" },
      },
      required: ["projectDir", "shaderName"],
    },
  },
  {
    name: "edit_shader",
    description: "Edit an existing shader's vertex and/or fragment code",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        shaderName: { type: "string", description: "Name of the existing shader to edit" },
        vertexCode: { type: "string", description: "New vertex shader GLSL ES code" },
        fragmentCode: { type: "string", description: "New fragment shader GLSL ES code" },
      },
      required: ["projectDir", "shaderName"],
    },
  },
  {
    name: "add_sound",
    description: "Import an audio file (.wav/.ogg/.mp3) as a new sound and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        soundName: { type: "string", description: "Name of the sound to create" },
        sourceFile: { type: "string", description: "Absolute path to a .wav, .ogg, or .mp3 file to import" },
        volume: { type: "number", description: "Playback volume (0-1)", default: 1.0 },
        preload: { type: "boolean", description: "Whether to preload the sound", default: true },
      },
      required: ["projectDir", "soundName", "sourceFile"],
    },
  },
  {
    name: "get_sound_info",
    description: "Get an existing sound's file, volume, and playback settings",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        soundName: { type: "string", description: "Name of the sound to inspect" },
      },
      required: ["projectDir", "soundName"],
    },
  },
  {
    name: "edit_sound",
    description: "Edit an existing sound's volume and/or preload flag (not its audio metadata, which is always derived from the real file)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        soundName: { type: "string", description: "Name of the existing sound to edit" },
        volume: { type: "number", description: "New playback volume (0-1)" },
        preload: { type: "boolean", description: "New preload flag" },
      },
      required: ["projectDir", "soundName"],
    },
  },
  {
    name: "add_font",
    description: "Create a new font referencing an installed system font by name and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        fontName: { type: "string", description: "Name of the font to create" },
        systemFontName: { type: "string", description: "Name of an installed system font (e.g. \"Arial\")" },
        size: { type: "number", description: "Font size in points", default: 12 },
        bold: { type: "boolean", description: "Bold style", default: false },
        italic: { type: "boolean", description: "Italic style", default: false },
      },
      required: ["projectDir", "fontName", "systemFontName"],
    },
  },
  {
    name: "get_font_info",
    description: "Get an existing font's system font name, size, and style",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        fontName: { type: "string", description: "Name of the font to inspect" },
      },
      required: ["projectDir", "fontName"],
    },
  },
  {
    name: "edit_font",
    description: "Edit an existing font's system font name, size, and/or style",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        fontName: { type: "string", description: "Name of the existing font to edit" },
        systemFontName: { type: "string", description: "New installed system font name" },
        size: { type: "number", description: "New font size in points" },
        bold: { type: "boolean", description: "New bold style" },
        italic: { type: "boolean", description: "New italic style" },
      },
      required: ["projectDir", "fontName"],
    },
  },
  {
    name: "add_tileset",
    description: "Create a new tile set from an existing sprite (add the sprite first with add_sprite_from_images) and register it in the project. Column/row/tile counts are computed from the sprite's real dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        tilesetName: { type: "string", description: "Name of the tile set to create" },
        spriteName: { type: "string", description: "Name of an existing sprite to use as the tile source image (add one first with add_sprite_from_images)" },
        tileWidth: { type: "number", description: "Width of one tile in pixels" },
        tileHeight: { type: "number", description: "Height of one tile in pixels" },
        tilehsep: { type: "number", description: "Horizontal spacing between tiles in the source sprite, in pixels", default: 0 },
        tilevsep: { type: "number", description: "Vertical spacing between tiles in the source sprite, in pixels", default: 0 },
        tilexoff: { type: "number", description: "Horizontal offset from the left edge of the source sprite before the first tile, in pixels", default: 0 },
        tileyoff: { type: "number", description: "Vertical offset from the top edge of the source sprite before the first tile, in pixels", default: 0 },
      },
      required: ["projectDir", "tilesetName", "spriteName", "tileWidth", "tileHeight"],
    },
  },
  {
    name: "get_tileset_info",
    description: "Get an existing tile set's source sprite, tile dimensions, and tile count",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        tilesetName: { type: "string", description: "Name of the tile set to inspect" },
      },
      required: ["projectDir", "tilesetName"],
    },
  },
  {
    name: "edit_tileset",
    description: "Edit an existing tile set's dimensions, spacing, or offset -- column/tile counts are recomputed from the real source sprite",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        tilesetName: { type: "string", description: "Name of the existing tile set to edit" },
        tileWidth: { type: "number", description: "New tile width in pixels" },
        tileHeight: { type: "number", description: "New tile height in pixels" },
        tilehsep: { type: "number", description: "New horizontal spacing between tiles, in pixels" },
        tilevsep: { type: "number", description: "New vertical spacing between tiles, in pixels" },
        tilexoff: { type: "number", description: "New horizontal offset before the first tile, in pixels" },
        tileyoff: { type: "number", description: "New vertical offset before the first tile, in pixels" },
      },
      required: ["projectDir", "tilesetName"],
    },
  },
  {
    name: "add_extension",
    description: "Create a new, empty extension shell (matches File > New Extension before any functions/constants/files are added in the IDE) and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        extensionName: { type: "string", description: "Name of the extension to create" },
      },
      required: ["projectDir", "extensionName"],
    },
  },
  {
    name: "get_extension_info",
    description: "Get an existing extension's version and file count",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        extensionName: { type: "string", description: "Name of the extension to inspect" },
      },
      required: ["projectDir", "extensionName"],
    },
  },
  {
    name: "add_particle_system",
    description: "Create a new particle system with one default emitter and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        particleSystemName: { type: "string", description: "Name of the particle system to create" },
      },
      required: ["projectDir", "particleSystemName"],
    },
  },
  {
    name: "get_particle_system_info",
    description: "Get an existing particle system's emitter count and names",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        particleSystemName: { type: "string", description: "Name of the particle system to inspect" },
      },
      required: ["projectDir", "particleSystemName"],
    },
  },
  {
    name: "add_anim_curve",
    description: "Create a new animation curve with one straight-line channel from (0,0) to (1,1) and register it in the project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        animCurveName: { type: "string", description: "Name of the animation curve to create" },
      },
      required: ["projectDir", "animCurveName"],
    },
  },
  {
    name: "get_anim_curve_info",
    description: "Get an existing animation curve's channel count, names, and point counts",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        animCurveName: { type: "string", description: "Name of the animation curve to inspect" },
      },
      required: ["projectDir", "animCurveName"],
    },
  },
  {
    name: "find_references",
    description: "Find every place a resource is referenced across the whole project (rooms placing instances, other objects parenting to it, GML code calling it, etc.) -- use before deleting or renaming anything",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        resourceName: { type: "string", description: "Name of the resource to search for references to" },
      },
      required: ["projectDir", "resourceName"],
    },
  },
  {
    name: "delete_resource",
    description: "Delete an existing resource. Refuses if it's still referenced elsewhere in the project unless force=true",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        category: { type: "string", enum: ["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"], description: "Resource category" },
        resourceName: { type: "string", description: "Name of the resource to delete" },
        force: { type: "boolean", description: "Delete even if still referenced elsewhere in the project", default: false },
      },
      required: ["projectDir", "category", "resourceName"],
    },
  },
  {
    name: "rename_resource",
    description: "Rename an existing resource, rewriting every reference to it across the whole project (other resources' name/path references, GML code) so nothing is left dangling",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
        category: { type: "string", enum: ["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"], description: "Resource category" },
        oldName: { type: "string", description: "Current name of the resource" },
        newName: { type: "string", description: "New name for the resource" },
      },
      required: ["projectDir", "category", "oldName", "newName"],
    },
  },
  {
    name: "lint_project",
    description: "Validate a whole project for dangling references, orphaned resources, missing folder registrations, and sound/sprite metadata that doesn't match the real underlying file -- run this before trusting a project is safe to open",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "compile_project",
    description: "Actually compile the project with GameMaker's real build tool (Igor) to catch real GML errors -- duplicate function names, syntax errors -- that structural checks like lint_project can't see. Requires the GameMaker runtime to be installed (skips gracefully with a clear message if not). Windows only.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the GameMaker project directory" },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "list_resources",
    description: "List resource names by type from the YYP file",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the GameMaker project directory",
        },
        kind: {
          type: "string",
          enum: ["rooms", "objects", "scripts", "sprites", "shaders", "sounds", "fonts", "notes", "tilesets", "extensions", "particles", "animcurves"],
          description: "Type of resources to list (optional)",
        },
      },
      required: ["projectDir"],
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool handler
async function dispatchTool(name: string, args: unknown) {
  switch (name) {
      case "create_project": {
        const { projectDir, name: projectName } = CreateProjectSchema.parse(args);
        const yyp = await ensureProjectScaffold(projectDir, projectName);
        await writeYyp(projectDir, yyp);
        return {
          content: [
            {
              type: "text",
              text: `✓ Created GameMaker project "${projectName}" at ${projectDir}`,
            },
          ],
        };
      }

      case "add_texture_group": {
        const { projectDir, groupName } = AddTextureGroupSchema.parse(args);
        const yyp = await loadYyp(projectDir);
        addTextureGroup(yyp, groupName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Texture group "${groupName}" created` }] };
      }

      case "add_audio_group": {
        const { projectDir, groupName } = AddAudioGroupSchema.parse(args);
        const yyp = await loadYyp(projectDir);
        addAudioGroup(yyp, groupName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Audio group "${groupName}" created` }] };
      }

      case "add_script": {
        const { projectDir, scriptName, code } = AddScriptSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addScript(projectDir, yyp, scriptName, code);
        await writeYyp(projectDir, yyp);
        return {
          content: [
            {
              type: "text",
              text: `✓ Script "${scriptName}" added to project`,
            },
          ],
        };
      }

      case "edit_script": {
        const { projectDir, scriptName, code, mode } = EditScriptSchema.parse(args);
        await editScript(projectDir, scriptName, code, mode);
        return {
          content: [
            {
              type: "text",
              text: `✓ Script "${scriptName}" ${mode === "replace" ? "replaced" : "appended to"}`,
            },
          ],
        };
      }

      case "add_object": {
        const { projectDir, objectName, events } = AddObjectSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addObject(projectDir, yyp, objectName, events);
        await writeYyp(projectDir, yyp);
        return {
          content: [
            {
              type: "text",
              text: `✓ Object "${objectName}" added to project with ${events.length} event(s)`,
            },
          ],
        };
      }

      case "add_object_event": {
        const { projectDir, objectName, eventType, eventNum, collisionTargetName, code } = AddObjectEventSchema.parse(args);
        await addObjectEvent(projectDir, objectName, { eventType, eventNum, collisionTargetName }, code);
        return {
          content: [
            {
              type: "text",
              text: `✓ Event (type ${eventType}, num ${eventNum}) added to object "${objectName}"`,
            },
          ],
        };
      }

      case "add_sprite_from_images": {
        const { projectDir, spriteName, framesDir } = AddSpriteSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addSpriteFromImages(projectDir, yyp, spriteName, framesDir);
        await writeYyp(projectDir, yyp);
        return {
          content: [
            {
              type: "text",
              text: `✓ Sprite "${spriteName}" imported from ${framesDir}`,
            },
          ],
        };
      }

      case "add_room": {
        const { projectDir, roomName, width, height, persistent, creationCode } =
          AddRoomSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addRoom(projectDir, yyp, roomName, { width, height, persistent, creationCode });
        await writeYyp(projectDir, yyp);
        return {
          content: [
            {
              type: "text",
              text: `✓ Room "${roomName}" (${width}x${height}) added to project`,
            },
          ],
        };
      }

      case "edit_room": {
        const { projectDir, roomName, width, height, persistent } = EditRoomSchema.parse(args);
        await editRoom(projectDir, roomName, { width, height, persistent });
        return {
          content: [
            {
              type: "text",
              text: `✓ Room "${roomName}" updated`,
            },
          ],
        };
      }

      case "add_room_instance": {
        const { projectDir, roomName, objectName, x, y, rotation, scaleX, scaleY } =
          AddRoomInstanceSchema.parse(args);
        const { instanceName } = await addRoomInstance(projectDir, roomName, objectName, x, y, {
          rotation, scaleX, scaleY
        });
        return {
          content: [
            {
              type: "text",
              text: `✓ Instance "${instanceName}" of "${objectName}" placed in "${roomName}" at (${x}, ${y})`,
            },
          ],
        };
      }

      case "reorder_room": {
        const { projectDir, roomName, newIndex } = ReorderRoomSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = reorderRoom(yyp, roomName, newIndex);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Room "${roomName}" moved to position ${newIndex}` }] };
      }

      case "move_room_relative": {
        const { projectDir, roomName, targetRoomName, position } = MoveRoomRelativeSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = moveRoomRelativeTo(yyp, roomName, targetRoomName, position);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Room "${roomName}" moved ${position} "${targetRoomName}"` }] };
      }

      case "add_note": {
        const { projectDir, noteName, content } = AddNoteSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addNote(projectDir, yyp, noteName, content);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Note "${noteName}" added to project` }] };
      }

      case "get_note_info": {
        const { projectDir, noteName } = GetNoteInfoSchema.parse(args);
        const info = await getNoteInfo(projectDir, noteName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "get_object_info": {
        const { projectDir, objectName } = GetObjectInfoSchema.parse(args);
        const info = await getObjectInfo(projectDir, objectName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "get_room_info": {
        const { projectDir, roomName } = GetRoomInfoSchema.parse(args);
        const info = await getRoomInfo(projectDir, roomName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "get_sprite_info": {
        const { projectDir, spriteName } = GetSpriteInfoSchema.parse(args);
        const info = await getSpriteInfo(projectDir, spriteName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "edit_sprite": {
        const { projectDir, spriteName, xorigin, yorigin, collisionKind, bboxMode, bbox_left, bbox_top, bbox_right, bbox_bottom } = EditSpriteSchema.parse(args);
        await editSprite(projectDir, spriteName, { xorigin, yorigin, collisionKind, bboxMode, bbox_left, bbox_top, bbox_right, bbox_bottom });
        return { content: [{ type: "text", text: `✓ Sprite "${spriteName}" updated` }] };
      }

      case "get_script_info": {
        const { projectDir, scriptName } = GetScriptInfoSchema.parse(args);
        const info = await getScriptInfo(projectDir, scriptName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "add_shader": {
        const { projectDir, shaderName, vertexCode, fragmentCode } = AddShaderSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addShader(projectDir, yyp, shaderName, vertexCode, fragmentCode);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Shader "${shaderName}" added to project` }] };
      }

      case "get_shader_info": {
        const { projectDir, shaderName } = GetShaderInfoSchema.parse(args);
        const info = await getShaderInfo(projectDir, shaderName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "edit_shader": {
        const { projectDir, shaderName, vertexCode, fragmentCode } = EditShaderSchema.parse(args);
        await editShader(projectDir, shaderName, { vertexCode, fragmentCode });
        return { content: [{ type: "text", text: `✓ Shader "${shaderName}" updated` }] };
      }

      case "add_sound": {
        const { projectDir, soundName, sourceFile, volume, preload } = AddSoundSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addSound(projectDir, yyp, soundName, sourceFile, { volume, preload });
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Sound "${soundName}" imported from ${sourceFile}` }] };
      }

      case "get_sound_info": {
        const { projectDir, soundName } = GetSoundInfoSchema.parse(args);
        const info = await getSoundInfo(projectDir, soundName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "edit_sound": {
        const { projectDir, soundName, volume, preload } = EditSoundSchema.parse(args);
        await editSound(projectDir, soundName, { volume, preload });
        return { content: [{ type: "text", text: `✓ Sound "${soundName}" updated` }] };
      }

      case "add_font": {
        const { projectDir, fontName, systemFontName, size, bold, italic } = AddFontSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        const result = await addFont(projectDir, yyp, fontName, systemFontName, { size, bold, italic });
        yyp = result.yyp;
        await writeYyp(projectDir, yyp);
        const text = `✓ Font "${fontName}" (${systemFontName}, ${size}pt) added to project`
          + (result.warning ? `\n⚠ ${result.warning}` : "");
        return { content: [{ type: "text", text }] };
      }

      case "get_font_info": {
        const { projectDir, fontName } = GetFontInfoSchema.parse(args);
        const info = await getFontInfo(projectDir, fontName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "edit_font": {
        const { projectDir, fontName, systemFontName, size, bold, italic } = EditFontSchema.parse(args);
        const result = await editFont(projectDir, fontName, { systemFontName, size, bold, italic });
        const text = `✓ Font "${fontName}" updated` + (result.warning ? `\n⚠ ${result.warning}` : "");
        return { content: [{ type: "text", text }] };
      }

      case "add_tileset": {
        const { projectDir, tilesetName, spriteName, tileWidth, tileHeight, tilehsep, tilevsep, tilexoff, tileyoff } = AddTilesetSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addTileset(projectDir, yyp, tilesetName, spriteName, tileWidth, tileHeight, { tilehsep, tilevsep, tilexoff, tileyoff });
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Tile set "${tilesetName}" created from sprite "${spriteName}" (${tileWidth}x${tileHeight} tiles)` }] };
      }

      case "get_tileset_info": {
        const { projectDir, tilesetName } = GetTilesetInfoSchema.parse(args);
        const info = await getTilesetInfo(projectDir, tilesetName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "edit_tileset": {
        const { projectDir, tilesetName, tileWidth, tileHeight, tilehsep, tilevsep, tilexoff, tileyoff } = EditTilesetSchema.parse(args);
        await editTileset(projectDir, tilesetName, { tileWidth, tileHeight, tilehsep, tilevsep, tilexoff, tileyoff });
        return { content: [{ type: "text", text: `✓ Tile set "${tilesetName}" updated` }] };
      }

      case "add_extension": {
        const { projectDir, extensionName } = AddExtensionSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addExtension(projectDir, yyp, extensionName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Extension "${extensionName}" created` }] };
      }

      case "get_extension_info": {
        const { projectDir, extensionName } = GetExtensionInfoSchema.parse(args);
        const info = await getExtensionInfo(projectDir, extensionName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "add_particle_system": {
        const { projectDir, particleSystemName } = AddParticleSystemSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addParticleSystem(projectDir, yyp, particleSystemName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Particle system "${particleSystemName}" created` }] };
      }

      case "get_particle_system_info": {
        const { projectDir, particleSystemName } = GetParticleSystemInfoSchema.parse(args);
        const info = await getParticleSystemInfo(projectDir, particleSystemName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "add_anim_curve": {
        const { projectDir, animCurveName } = AddAnimCurveSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await addAnimCurve(projectDir, yyp, animCurveName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ Animation curve "${animCurveName}" created` }] };
      }

      case "get_anim_curve_info": {
        const { projectDir, animCurveName } = GetAnimCurveInfoSchema.parse(args);
        const info = await getAnimCurveInfo(projectDir, animCurveName);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      }

      case "find_references": {
        const { projectDir, resourceName } = FindReferencesSchema.parse(args);
        const refs = await findReferences(projectDir, resourceName);
        const text = refs.length === 0
          ? `No references to "${resourceName}" found elsewhere in the project -- safe to delete.`
          : `Found ${refs.length} reference(s) to "${resourceName}":\n` +
            refs.map(r => `  ${r.file}:${r.line}  ${r.context}`).join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "delete_resource": {
        const { projectDir, category, resourceName, force } = DeleteResourceSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await deleteResource(projectDir, yyp, category, resourceName, force);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ ${category.slice(0, -1)} "${resourceName}" deleted` }] };
      }

      case "rename_resource": {
        const { projectDir, category, oldName, newName } = RenameResourceSchema.parse(args);
        let yyp = await loadYyp(projectDir);
        yyp = await renameResource(projectDir, yyp, category, oldName, newName);
        await writeYyp(projectDir, yyp);
        return { content: [{ type: "text", text: `✓ ${category.slice(0, -1)} "${oldName}" renamed to "${newName}"` }] };
      }

      case "lint_project": {
        const { projectDir } = ProjectSchema.parse(args);
        const issues = await lintProject(projectDir);
        const errors = issues.filter(i => i.severity === "error");
        const warnings = issues.filter(i => i.severity === "warning");
        const text = issues.length === 0
          ? "No issues found -- project looks clean."
          : `${errors.length} error(s), ${warnings.length} warning(s):\n` +
            issues.map(i => `[${i.severity.toUpperCase()}] ${i.message}${i.file ? ` (${i.file})` : ""}`).join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "compile_project": {
        const { projectDir } = ProjectSchema.parse(args);
        const result = await compileProject(projectDir);
        if (!result.available) {
          return { content: [{ type: "text", text: result.message }] };
        }
        const text = result.success
          ? "Compile succeeded -- GameMaker's real build tool compiled this project with no errors."
          : `Compile FAILED:\n${result.message}`;
        return { content: [{ type: "text", text }] };
      }

      case "list_resources": {
        const { projectDir, kind } = ListResourcesSchema.parse(args);
        const yyp = await loadYyp(projectDir);
        const filtered = yyp.resources.filter((r: any) => !kind || r.id?.path?.startsWith(`${kind}/`));
        const list = filtered.map((r: any) => r.id?.name || "unknown");
        return {
          content: [
            {
              type: "text",
              text: `Resources${kind ? ` (${kind})` : ""}:\n${JSON.stringify(list, null, 2)}`,
            },
          ],
        };
      }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const projectDir = (args as any)?.projectDir;

  try {
    return typeof projectDir === "string"
      ? await withProjectLock(projectDir, () => dispatchTool(name, args))
      : await dispatchTool(name, args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GameMaker MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

