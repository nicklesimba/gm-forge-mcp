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
      if (chunkSize < 16 || chunkStart + 16 > buf.length) {
        throw new Error(`"${filePath}" has a truncated WAV fmt chunk`);
      }
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

export interface OggMetadata {
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

/**
 * Parse an Ogg Vorbis file's real metadata. Channels and sample rate come
 * from the Vorbis identification header (first packet of the first page);
 * duration comes from the last page's granule position (total PCM samples)
 * divided by the sample rate. Same rule as the WAV parser: declared metadata
 * must come from the actual file, never a plausible-looking default.
 */
export async function parseOggMetadata(filePath: string): Promise<OggMetadata> {
  const buf = await fs.readFile(filePath);
  if (buf.length < 58 || buf.toString("ascii", 0, 4) !== "OggS") {
    throw new Error(`"${filePath}" is not a valid Ogg file`);
  }

  // First page payload: after the 27-byte page header + segment table.
  const segmentCount = buf.readUInt8(26);
  const firstPacketStart = 27 + segmentCount;
  // Vorbis identification header: packet type 1, magic "vorbis", then
  // version(4), channels(1), sampleRate(4).
  if (buf.length < firstPacketStart + 16 ||
      buf.readUInt8(firstPacketStart) !== 1 ||
      buf.toString("ascii", firstPacketStart + 1, firstPacketStart + 7) !== "vorbis") {
    throw new Error(`"${filePath}" is an Ogg file but not Ogg Vorbis -- only Vorbis-encoded .ogg is supported`);
  }
  const channels = buf.readUInt8(firstPacketStart + 11);
  const sampleRate = buf.readUInt32LE(firstPacketStart + 12);

  // Last page's granule position = total PCM sample count. Scan backwards
  // for the final "OggS" capture pattern.
  let granule = 0n;
  for (let i = buf.length - 27; i >= 0; i--) {
    if (buf.readUInt32BE(i) === 0x4f676753) {
      granule = buf.readBigUInt64LE(i + 6);
      break;
    }
  }

  const durationSeconds = sampleRate > 0 && granule > 0n ? Number(granule) / sampleRate : 0;
  return { sampleRate, channels, durationSeconds };
}

/**
 * Add a new sound to the project from an existing audio file. Metadata
 * (sample rate, channels, duration) is always parsed from the real file --
 * .wav and .ogg (Vorbis) have parsers; .mp3 doesn't yet, so it's rejected
 * rather than risking declared-vs-real metadata drift, which has crashed
 * GameMaker's audio engine before.
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
  if (ext !== ".wav" && ext !== ".ogg") {
    throw new Error(`Only .wav and .ogg are currently supported (got "${ext}") -- .mp3 metadata parsing isn't implemented yet, and guessing at its real properties risks the same crash this writer was built to avoid`);
  }

  let sampleRate: number;
  let channels: number;
  let durationSeconds: number;
  let bitDepth: number;
  if (ext === ".wav") {
    const meta = await parseWavMetadata(sourceFile);
    if (meta.bitsPerSample !== 8 && meta.bitsPerSample !== 16) {
      throw new Error(`Unsupported bit depth ${meta.bitsPerSample} -- only 8-bit or 16-bit WAV is supported`);
    }
    ({ sampleRate, channels, durationSeconds } = meta);
    bitDepth = meta.bitsPerSample === 16 ? 1 : 0;
  } else {
    ({ sampleRate, channels, durationSeconds } = await parseOggMetadata(sourceFile));
    bitDepth = 1; // Vorbis decodes to 16-bit here; there's no bit depth in the file itself
  }

  if (!ALLOWED_SAMPLE_RATES.includes(sampleRate)) {
    throw new Error(`Sample rate ${sampleRate}Hz isn't one GameMaker supports (${ALLOWED_SAMPLE_RATES.join(", ")}) -- re-export the file at one of those rates`);
  }
  if (channels < 1 || channels > 2) {
    throw new Error(`Unsupported channel count ${channels} -- only mono (1) or stereo (2) are supported`);
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
    bitDepth,
    channelFormat: channels === 2 ? 1 : 0,
    // SoundCompression enum (from @bscotch/yy's YySound schema):
    // 0 = Uncompressed (.wav), 1 = Compressed (.ogg)
    compression: ext === ".ogg" ? 1 : 0,
    compressionQuality: 0,
    conversionMode: 0,
    duration: durationSeconds,
    exportDir: "",
    name: soundName,
    parent: {
      name: "Sounds",
      path: "folders/Sounds.yy"
    },
    preload: options.preload ?? true,
    resourceType: "GMSound",
    resourceVersion: RESOURCE_VERSIONS.sound,
    sampleRate,
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
