import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, registerResource, validateResourceName, RESOURCE_VERSIONS } from "./yyp.js";

// Ground truth: a real GMAnimCurve captured from @bscotch/yy's own sample
// fixtures (packages/yy/samples/animcurves/curveQuint.yy in bscotch/stitch).
// That capture predates fields the currently installed IDE (2024.14.4.222)
// requires -- as with particle systems, every field below not present in
// the original capture (the root "$GMAnimCurve" tag/"%Name", and the
// channel's "$GMAnimCurveChannel" tag/"%Name") was discovered one at a time
// via real ProjectTool validation failures against the live MCP_IDE_Check
// project, not guessed. The curve shape itself (two points, a straight line
// from (0,0) to (1,1)) matches what "File > New Animation Curve" produces.
function newAnimCurveYy(name: string) {
  return {
    "$GMAnimCurve": "",
    "%Name": name,
    name,
    channels: [defaultChannel("channel0")],
    function: 0,
    parent: { name: "Animation Curves", path: "folders/Animation Curves.yy" },
    resourceType: "GMAnimCurve",
    resourceVersion: RESOURCE_VERSIONS.animCurve
  };
}

function defaultChannel(channelName: string) {
  return {
    "$GMAnimCurveChannel": "",
    "%Name": channelName,
    name: channelName,
    colour: 4290799884,
    points: [
      { x: 0.0, y: 0.0, th0: 0.0, th1: 0.0, tv0: 0.0, tv1: 0.0 },
      { x: 1.0, y: 1.0, th0: 0.0, th1: 0.0, tv0: 0.0, tv1: 0.0 }
    ],
    resourceType: "GMAnimCurveChannel",
    resourceVersion: RESOURCE_VERSIONS.animCurveChannel,
    visible: true
  };
}

/**
 * Add a new animation curve with one straight-line channel from (0,0) to
 * (1,1) -- matches what "File > New Animation Curve" produces before any
 * points are edited in the IDE.
 */
export async function addAnimCurve(projectDir: string, yyp: Yyp, name: string): Promise<Yyp> {
  validateResourceName(yyp, name);

  const dir = path.join(projectDir, "animcurves", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.yy`),
    JSON.stringify(newAnimCurveYy(name), null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Animation Curves");
  registerResource(yyp, name, `animcurves/${name}/${name}.yy`);

  return yyp;
}
