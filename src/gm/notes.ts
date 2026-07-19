import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, validateResourceName, RESOURCE_VERSIONS, registerResource } from "./yyp.js";

// Notes are plain-text project documentation, never compiled into the game.
// Content lives in a separate .txt file, same as scripts use .gml.
export async function addNote(
  projectDir: string,
  yyp: Yyp,
  noteName: string,
  content: string = ""
): Promise<Yyp> {
  validateResourceName(yyp, noteName);

  const dir = path.join(projectDir, "notes", noteName);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(dir, `${noteName}.txt`), content, "utf8");

  const noteYy = {
    "$GMNotes": "",
    "%Name": noteName,
    name: noteName,
    parent: {
      name: "Notes",
      path: "folders/Notes.yy"
    },
    resourceType: "GMNotes",
    resourceVersion: RESOURCE_VERSIONS.note
  };

  await fs.writeFile(
    path.join(dir, `${noteName}.yy`),
    JSON.stringify(noteYy, null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Notes");

  registerResource(yyp, noteName, `notes/${noteName}/${noteName}.yy`);

  return yyp;
}
