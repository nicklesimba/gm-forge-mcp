import { promises as fs } from "fs";
import path from "path";

const PROJECT_TOOL_DEFAULT_PATH = "C:\\Program Files\\GameMaker\\packages\\gm-tools\\project-tool-win-x64\\ProjectTool.exe";
const RUNTIME_JSON_PATH = "C:\\ProgramData\\GameMakerStudio2\\runtime.json";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// GameMaker's official headless project validator ships with the base IDE
// install, so its path is stable for a default install -- but a nonstandard
// install location or no GameMaker at all means null, and callers need to
// handle that gracefully. Explicitly gated to win32 rather than relying on
// the literal backslash path simply not existing on other platforms -- that
// happens to work today but is an accident of POSIX treating "\\" as a
// literal filename character, not a guarantee.
export async function findProjectTool(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  return (await fileExists(PROJECT_TOOL_DEFAULT_PATH)) ? PROJECT_TOOL_DEFAULT_PATH : null;
}

// Locates Igor via whichever runtime GameMaker currently has active
// (runtime.json's "active" field), rather than a hardcoded version --
// the exact runtime differs per machine and changes as GameMaker updates.
// Null just means no runtime has been downloaded yet (normal on a project
// that's never been run from the IDE). Also gated to win32: the runtime.json
// location and the igorPath's "windows/x64" segment below are both
// Windows-specific, and this project has no Mac/Linux GameMaker install to
// verify the equivalent paths against -- returning null here rather than
// guessing an unverified path.
export async function findIgor(): Promise<{ igorPath: string; runtimePath: string } | null> {
  if (process.platform !== "win32") return null;
  if (!(await fileExists(RUNTIME_JSON_PATH))) {
    return null;
  }

  let manifest: any;
  try {
    manifest = JSON.parse(await fs.readFile(RUNTIME_JSON_PATH, "utf8"));
  } catch {
    return null;
  }

  const activeVersion: string | undefined = manifest.active;
  const entry: string | undefined = activeVersion ? manifest[activeVersion] : undefined;
  if (!entry) {
    return null;
  }

  // Entry looks like "<runtimePath>&<rss feed url>" -- we only want the path.
  const runtimePath = entry.split("&")[0].replace(/\//g, "\\");
  const igorPath = path.join(runtimePath, "bin", "igor", "windows", "x64", "Igor.exe");

  return (await fileExists(igorPath)) ? { igorPath, runtimePath } : null;
}
