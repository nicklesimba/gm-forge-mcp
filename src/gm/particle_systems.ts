import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, registerResource, validateResourceName, RESOURCE_VERSIONS } from "./yyp.js";

// Ground truth: a real GMParticleSystem captured from a published GameMaker
// project (IDE 2023.4.0.84) -- no Convoy example and no @bscotch/yy schema
// exist for this resource type. That source predates several fields the
// currently installed IDE (2024.14.4.222) requires; every field below not
// present in the original capture (the root "$GMParticleSystem" tag, the
// emitter's "$GMPSEmitter" tag and "%Name", and the six emitDelay*/
// emitInterval* fields) was discovered one at a time via real ProjectTool
// validation failures against the live MCP_IDE_Check project, not guessed.
// resourceVersion is also from that older project; ProjectTool upgrades
// stale version strings automatically, verified against a real project.
function defaultEmitter(emitterName: string) {
  return {
    "$GMPSEmitter": "",
    "%Name": emitterName,
    resourceType: "GMPSEmitter",
    resourceVersion: RESOURCE_VERSIONS.particleEmitter,
    name: emitterName,
    additiveBlend: false,
    directionIncrease: 0.0,
    directionMax: 360.0,
    directionMin: 0.0,
    directionWiggle: 0.0,
    distribution: 0,
    editorColour: 1090519039,
    editorDrawShape: true,
    emitCount: 1,
    emitDelayMax: 0.0,
    emitDelayMin: 0.0,
    emitDelayUnits: 0,
    emitIntervalMax: 0.0,
    emitIntervalMin: 0.0,
    emitIntervalUnits: 0,
    enabled: true,
    endColour: 16777215,
    GMPresetName: null,
    gravityDirection: 270.0,
    gravityForce: 0.0,
    headPosition: 0.0,
    lifetimeMax: 40.0,
    lifetimeMin: 40.0,
    linkedEmitter: null,
    locked: false,
    midColour: 4294967295,
    mode: 1,
    orientationIncrease: 0.0,
    orientationMax: 0.0,
    orientationMin: 0.0,
    orientationRelative: false,
    orientationWiggle: 0.0,
    regionH: 200.0,
    regionW: 200.0,
    regionX: 0.0,
    regionY: 0.0,
    scaleX: 0.5,
    scaleY: 0.5,
    shape: 0,
    sizeIncrease: 0.0,
    sizeMax: 1.0,
    sizeMin: 1.0,
    sizeWiggle: 0.0,
    spawnOnDeathCount: 1,
    spawnOnDeathGMPreset: null,
    spawnOnDeathId: null,
    spawnOnUpdateCount: 1,
    spawnOnUpdateGMPreset: null,
    spawnOnUpdateId: null,
    speedIncrease: 0.0,
    speedMax: 5.0,
    speedMin: 5.0,
    speedWiggle: 0.0,
    spriteAnimate: false,
    spriteId: null,
    spriteRandom: false,
    spriteStretch: true,
    startColour: 4294967295,
    texture: 1
  };
}

function newParticleSystemYy(name: string) {
  return {
    "$GMParticleSystem": "",
    "%Name": name,
    resourceType: "GMParticleSystem",
    resourceVersion: RESOURCE_VERSIONS.particleSystem,
    name,
    backdropHeight: 768,
    backdropImageOpacity: 0.5,
    backdropImagePath: "",
    backdropWidth: 1366,
    backdropXOffset: 0.0,
    backdropYOffset: 0.0,
    drawOrder: 0,
    emitters: [defaultEmitter("Emitter")],
    parent: { name: "Particles", path: "folders/Particles.yy" },
    showBackdrop: true,
    showBackdropImage: false,
    xorigin: 0,
    yorigin: 0
  };
}

/**
 * Add a new particle system with one default emitter, matching what a
 * fresh "File > New Particle System" produces. The default emitter's many
 * numeric fields are real captured values, not invented ones.
 */
export async function addParticleSystem(projectDir: string, yyp: Yyp, name: string): Promise<Yyp> {
  validateResourceName(yyp, name);

  const dir = path.join(projectDir, "particles", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.yy`),
    JSON.stringify(newParticleSystemYy(name), null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Particles");
  registerResource(yyp, name, `particles/${name}/${name}.yy`);

  return yyp;
}
