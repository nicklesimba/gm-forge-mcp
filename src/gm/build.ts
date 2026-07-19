import { spawn, execFile, execFileSync } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { findIgor } from "./gamemaker-tools.js";

export interface CompileResult {
  available: boolean;
  success: boolean;
  errors: string[];
  message: string;
}

const BUILD_TIMEOUT_MS = 180_000;
const SUCCESS_MARKER = "[Run] Run game";

/**
 * Igor's asset compiler prints "Error : <detail>" appended directly onto the
 * end of whatever stage was running (e.g. "Compile Scripts...Error : ..."),
 * not on its own line -- so this searches for the marker anywhere in each
 * line and slices from there, rather than anchoring to line start.
 */
function extractCompileErrors(output: string): string[] {
  return output
    .split("\n")
    .map(l => l.trim())
    .filter(l => /Error\s*:/.test(l))
    .map(l => l.slice(l.search(/Error\s*:/)));
}

// findIgor() only ever returns non-null on win32 (see gamemaker-tools.ts),
// so in practice only the taskkill branch is reachable today. The POSIX
// branch is a plain best-effort process.kill (doesn't recurse into a
// child's own children the way taskkill /T does) rather than untested
// guesswork -- it's standard Node API behavior, kept here so this doesn't
// silently do nothing if Igor detection is ever extended to Mac/Linux.
function killTree(pid: number | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], () => resolve());
    } else {
      try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
      resolve();
    }
  });
}

/**
 * Tracks Igor PIDs currently running so a graceful server shutdown (Ctrl+C,
 * SIGTERM, a normal process exit) can kill them on the way out, instead of
 * leaving an orphaned Igor/game process behind. This does NOT cover a hard
 * kill of the server itself (SIGKILL, taskkill /F on our own PID) -- by
 * definition, no cleanup code in this process can run in that case. A true
 * fix for that needs a Windows Job Object (CreateJobObject +
 * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), which Node doesn't expose without a
 * native addon -- not something to add as a dependency for this alone.
 */
const activeIgorPids = new Set<number>();
let shutdownHandlersRegistered = false;

function registerShutdownCleanup(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  // SIGINT/SIGTERM intercept the shutdown before it happens, so there's time
  // to await the kills before actually exiting.
  const killAllTrackedThenExit = async () => {
    await Promise.all([...activeIgorPids].map(pid => killTree(pid)));
    process.exit(0);
  };
  process.on("SIGINT", killAllTrackedThenExit);
  process.on("SIGTERM", killAllTrackedThenExit);

  // "exit" fires synchronously during actual shutdown -- async work isn't
  // guaranteed to complete after this point, so this is a synchronous
  // last-resort best effort, not the primary cleanup path.
  process.on("exit", () => {
    for (const pid of activeIgorPids) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)]);
        } else {
          process.kill(pid, "SIGKILL");
        }
      } catch { /* best effort */ }
    }
  });
}

/**
 * Windows doesn't always release a just-killed process's file handles
 * immediately -- a game process that actually launched (DirectX/audio) can
 * hold them for several seconds during teardown, longer than is reasonable
 * to make a caller wait on. Retry generously, but callers should fire this
 * without awaiting it rather than block the compile result on cleanup.
 */
async function rmWithRetry(dir: string, attempts = 15): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (e: any) {
      if (i === attempts - 1) {
        console.error(`gm-forge-mcp: gave up cleaning up temp build dir after ${attempts} attempts, left behind at ${dir}: ${e.message}`);
        return;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

/**
 * Run GameMaker's real compiler (Igor, via the VM runtime) against the
 * project. This is the only check in the tool that catches actual GML
 * compile errors (duplicate function names, syntax errors, etc.) -- every
 * other tool here only validates project *structure*, which a duplicate
 * script name compile error slipped straight through.
 *
 * We use `Windows Run` rather than `Windows Package`/`PackageZip`: Package
 * silently short-circuits before compiling scripts unless fully configured,
 * and PackageZip requires packaging permissions that depend on account
 * licensing tier. Run is what every license tier can do and is the only
 * worker/command observed to perform a genuine full compile. Because a
 * successful Run launches the actual game, we watch stdout for the launch
 * marker (proof the build succeeded) and kill the process tree ourselves
 * the moment we see it -- we only want to know if it compiles, not to leave
 * a game window open as a side effect of a check.
 */
export async function compileProject(projectDir: string): Promise<CompileResult> {
  registerShutdownCleanup();

  const igor = await findIgor();
  if (!igor) {
    return {
      available: false,
      success: false,
      errors: [],
      message: "GameMaker's Igor build tool isn't available on this machine yet -- no runtime has been downloaded (open the project in the GameMaker IDE and click Run once, which downloads it), so a real compile check can't be run. Structural checks (lint_project) still apply."
    };
  }

  const yypFiles = (await fs.readdir(projectDir)).filter(f => f.endsWith(".yyp"));
  if (yypFiles.length === 0) {
    throw new Error(`No .yyp file found in ${projectDir}`);
  }
  const yypPath = path.join(projectDir, yypFiles[0]);

  const workDir = path.join(os.tmpdir(), `gm-forge-igor-${crypto.randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  const result = await new Promise<CompileResult>((resolve) => {
    const child = spawn(
      igor.igorPath,
      [
        `--project=${yypPath}`,
        `--runtimePath=${igor.runtimePath}`,
        `--cache=${workDir}`,
        "-r", "VM", "Windows", "Run"
      ],
      { cwd: workDir }
    );
    if (child.pid) activeIgorPids.add(child.pid);

    let output = "";
    let settled = false;

    const finish = (result: CompileResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      killTree(child.pid).then(() => {
        if (child.pid) activeIgorPids.delete(child.pid);
        resolve(result);
      });
    };

    const safetyTimer = setTimeout(() => {
      finish({ available: true, success: false, errors: [], message: "Compile check timed out waiting for Igor." });
    }, BUILD_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(SUCCESS_MARKER)) {
        finish({ available: true, success: true, errors: [], message: "Project compiled successfully." });
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0) {
        finish({ available: true, success: true, errors: [], message: "Project compiled successfully." });
        return;
      }
      const errors = extractCompileErrors(output);
      finish({
        available: true,
        success: false,
        errors,
        message: errors.length > 0
          ? `Compile failed:\n${errors.join("\n")}`
          : `Igor exited with a failure (code ${code}):\n${output.trim().slice(-2000)}`
      });
    });

    child.on("error", (err) => {
      finish({ available: true, success: false, errors: [], message: `Failed to launch Igor: ${err.message}` });
    });
  });

  // Fire-and-forget: a just-killed game process can hold file handles for
  // several seconds during teardown, and that's not worth making the caller
  // wait on -- they already have their answer.
  void rmWithRetry(workDir);

  return result;
}
