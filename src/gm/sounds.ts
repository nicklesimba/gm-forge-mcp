import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, ensureAudioGroup, validateResourceName, RESOURCE_VERSIONS, registerResource, parseGameMakerJson, assertSafeResourceName } from "./yyp.js";

export interface SoundOptions {
  volume?: number;
  preload?: boolean;
}

export const ALLOWED_SAMPLE_RATES = [5512, 11025, 22050, 32000, 44100, 48000];

export interface WavMetadata {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
}

/**
 * Parse a WAV file's real header. GameMaker's own audio prep code crashed
 * (System.NullReferenceException in SoundInstance.PrepareToPlay) when our
 * .yy declared metadata (sampleRate, channelFormat) that didn't match the
 * actual file -- same class of bug as the sprite bbox fix: never hardcode
 * plausible-looking metadata, always derive it from the real file.
 */
export async function parseWavMetadata(filePath: string): Promise<WavMetadata> {
  const buf = await fs.readFile(filePath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`"${filePath}" is not a valid WAV file`);
  }

  let offset = 12;
  let channels = 0, sampleRate = 0, bitsPerSample = 0, dataSize = 0;
  let foundFmt = false, foundData = false;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      channels = buf.readUInt16LE(chunkStart + 2);
      sampleRate = buf.readUInt32LE(chunkStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkStart + 14);
      foundFmt = true;
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      foundData = true;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!foundFmt || !foundData) {
    throw new Error(`"${filePath}" is missing a required WAV chunk (fmt/data)`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const durationSeconds = bytesPerSample > 0 && channels > 0 && sampleRate > 0
    ? dataSize / (sampleRate * channels * bytesPerSample)
    : 0;

  return { sampleRate, channels, bitsPerSample, durationSeconds };
}

/**
 * Add a new sound to the project from an existing audio file. Full metadata
 * derivation (sample rate, channels, bit depth, duration) is only supported
 * for .wav right now, since that requires parsing the real file rather than
 * guessing -- .ogg/.mp3 need their own format-specific parsers to be equally
 * safe and aren't wired in yet.
 */
export async function addSound(
  projectDir: string,
  yyp: Yyp,
  soundName: string,
  sourceFile: string,
  options: SoundOptions = {}
): Promise<Yyp> {
  validateResourceName(yyp, soundName);

  const ext = path.extname(sourceFile).toLowerCase();
  if (ext !== ".wav") {
    throw new Error(`Only .wav is currently supported (got "${ext}") -- .ogg/.mp3 metadata parsing isn't implemented yet, and guessing at their real properties risks the same crash this writer was built to avoid`);
  }

  const meta = await parseWavMetadata(sourceFile);
  if (!ALLOWED_SAMPLE_RATES.includes(meta.sampleRate)) {
    throw new Error(`WAV sample rate ${meta.sampleRate}Hz isn't one GameMaker supports (${ALLOWED_SAMPLE_RATES.join(", ")}) -- re-export the file at one of those rates`);
  }
  if (meta.channels < 1 || meta.channels > 2) {
    throw new Error(`Unsupported channel count ${meta.channels} -- only mono (1) or stereo (2) are supported`);
  }
  if (meta.bitsPerSample !== 8 && meta.bitsPerSample !== 16) {
    throw new Error(`Unsupported bit depth ${meta.bitsPerSample} -- only 8-bit or 16-bit WAV is supported`);
  }

  const dir = path.join(projectDir, "sounds", soundName);
  await fs.mkdir(dir, { recursive: true });

  const soundFileName = `${soundName}${ext}`;
  await fs.copyFile(sourceFile, path.join(dir, soundFileName));

  const soundYy = {
    "$GMSound": "v2",
    "%Name": soundName,
    audioGroupId: {
      name: "audiogroup_default",
      path: "audiogroups/audiogroup_default"
    },
    bitDepth: meta.bitsPerSample === 16 ? 1 : 0,
    channelFormat: meta.channels === 2 ? 1 : 0,
    compression: 0,
    compressionQuality: 0,
    conversionMode: 0,
    duration: meta.durationSeconds,
    exportDir: "",
    name: soundName,
    parent: {
      name: "Sounds",
      path: "folders/Sounds.yy"
    },
    preload: options.preload ?? true,
    resourceType: "GMSound",
    resourceVersion: RESOURCE_VERSIONS.sound,
    sampleRate: meta.sampleRate,
    soundFile: soundFileName,
    volume: options.volume ?? 1.0
  };

  await fs.writeFile(
    path.join(dir, `${soundName}.yy`),
    JSON.stringify(soundYy, null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Sounds");
  ensureAudioGroup(yyp);

  registerResource(yyp, soundName, `sounds/${soundName}/${soundName}.yy`);

  return yyp;
}

export interface SoundEditOptions {
  volume?: number;
  preload?: boolean;
}

/**
 * Edit an existing sound's volume/preload -- pure playback settings, not
 * the audio metadata (sampleRate/channelFormat/bitDepth/duration) derived
 * from the real file, which stays off-limits here since declaring those
 * independently of the actual file is the exact crash class addSound exists
 * to prevent.
 */
export async function editSound(
  projectDir: string,
  soundName: string,
  options: SoundEditOptions
): Promise<void> {
  assertSafeResourceName(soundName);
  const yyPath = path.join(projectDir, "sounds", soundName, `${soundName}.yy`);
  let sound: any;
  try {
    sound = parseGameMakerJson(await fs.readFile(yyPath, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`Sound "${soundName}" does not exist (expected ${yyPath})`);
    }
    throw new Error(`Failed to read sound "${soundName}" at ${yyPath}: ${e.message}`);
  }

  if (options.volume !== undefined) sound.volume = options.volume;
  if (options.preload !== undefined) sound.preload = options.preload;

  await fs.writeFile(yyPath, JSON.stringify(sound, null, 2), "utf8");
}
