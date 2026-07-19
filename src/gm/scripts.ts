import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, registerResource, validateResourceName, assertSafeResourceName, RESOURCE_VERSIONS } from "./yyp.js";

interface ScriptFiles {
  dir: string;
  gmlFile: string;
  yyFile: string;
  catalogPath: string;
}

function scriptFiles(projectDir: string, name: string): ScriptFiles {
  const dir = path.join(projectDir, "scripts", name);
  return {
    dir,
    gmlFile: path.join(dir, `${name}.gml`),
    yyFile: path.join(dir, `${name}.yy`),
    catalogPath: `scripts/${name}/${name}.yy`
  };
}

function newScriptYy(name: string) {
  return {
    name,
    resourceType: "GMScript",
    resourceVersion: RESOURCE_VERSIONS.script,
    isDnD: false,
    isCompatibility: false,
    parent: { name: "Scripts", path: "folders/Scripts.yy" },
    "$GMScript": "v1",
    "%Name": name
  };
}

export async function addScript(projectDir: string, yyp: Yyp, name: string, code: string): Promise<Yyp> {
  validateResourceName(yyp, name);
  const files = scriptFiles(projectDir, name);

  await fs.mkdir(files.dir, { recursive: true });
  await fs.writeFile(files.gmlFile, code, "utf8");
  await fs.writeFile(files.yyFile, JSON.stringify(newScriptYy(name), null, 2), "utf8");

  ensureFolder(yyp, "Scripts");
  registerResource(yyp, name, files.catalogPath);

  return yyp;
}

async function requireScriptFile(gmlFile: string, name: string): Promise<void> {
  try {
    await fs.access(gmlFile);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Script "${name}" does not exist (expected ${gmlFile})`);
    }
    throw new Error(`Failed to access script "${name}" at ${gmlFile}: ${e.message}`);
  }
}

/**
 * "replace" overwrites the .gml file; "append" adds to the end. The .yy
 * descriptor never changes for either mode, so it's untouched here.
 */
export async function editScript(
  projectDir: string,
  name: string,
  code: string,
  mode: "replace" | "append" = "append"
): Promise<void> {
  assertSafeResourceName(name);
  const { gmlFile } = scriptFiles(projectDir, name);
  await requireScriptFile(gmlFile, name);

  if (mode === "replace") {
    await fs.writeFile(gmlFile, code, "utf8");
    return;
  }

  if (code.trim().length === 0) {
    throw new Error(`Refusing to append empty/whitespace-only code to "${name}" -- use mode "replace" if you meant to clear it`);
  }
  const current = await fs.readFile(gmlFile, "utf8");
  if (current.includes(code.trim())) {
    throw new Error(`Script "${name}" already contains this exact code -- refusing to append a duplicate. Use mode "replace" if this is intentional.`);
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(gmlFile, `${current}${separator}${code}`, "utf8");
}
