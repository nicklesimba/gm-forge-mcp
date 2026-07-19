import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, registerResource, validateResourceName, RESOURCE_VERSIONS } from "./yyp.js";

// Real GameMaker extension .yy files carry ~40 per-platform fields
// (Android/iOS/tvOS injection settings, etc.) that @bscotch/yy's own schema
// doesn't fully type (it's a "loose" schema, deferring to whatever's
// there). Captured from a real extension sample instead. Scoped to an
// empty shell (no functions/constants) -- a populated one needs ground
// truth for the nested GMExtensionFile/function/constant shape that no
// available real example actually has populated.
function newExtensionYy(name: string) {
  return {
    "$GMExtension": "",
    "%Name": name,
    androidactivityinject: "",
    androidclassname: "",
    androidcodeinjection: "",
    androidinject: "",
    androidmanifestinject: "",
    androidPermissions: [],
    androidProps: false,
    androidsourcedir: "",
    author: "",
    classname: "",
    copyToTargets: -1,
    description: "",
    exportToGame: true,
    extensionVersion: "0.0.1",
    files: [],
    gradleinject: "",
    hasConvertedCodeInjection: true,
    helpfile: "",
    HTML5CodeInjection: "",
    html5Props: false,
    IncludedResources: [],
    installdir: "",
    iosCocoaPodDependencies: "",
    iosCocoaPods: "",
    ioscodeinjection: "",
    iosdelegatename: "",
    iosplistinject: "",
    iosProps: false,
    iosSystemFrameworkEntries: [],
    iosThirdPartyFrameworkEntries: [],
    license: "",
    maccompilerflags: "",
    maclinkerflags: "",
    macsourcedir: "",
    name,
    options: [],
    optionsFile: "options.json",
    packageId: "",
    parent: { name: "Extensions", path: "folders/Extensions.yy" },
    productId: "",
    resourceType: "GMExtension",
    resourceVersion: RESOURCE_VERSIONS.extension,
    sourcedir: "",
    supportedTargets: -1,
    tvosclassname: null,
    tvosCocoaPodDependencies: "",
    tvosCocoaPods: "",
    tvoscodeinjection: "",
    tvosdelegatename: null,
    tvosmaccompilerflags: "",
    tvosmaclinkerflags: "",
    tvosplistinject: "",
    tvosProps: false,
    tvosSystemFrameworkEntries: [],
    tvosThirdPartyFrameworkEntries: []
  };
}

/**
 * Add a new, empty extension shell -- matches what "File > New Extension"
 * produces before any functions/constants/files are added in the IDE.
 * Populating those needs ground truth this project doesn't have yet (see
 * module comment).
 */
export async function addExtension(projectDir: string, yyp: Yyp, name: string): Promise<Yyp> {
  validateResourceName(yyp, name);

  const dir = path.join(projectDir, "extensions", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.yy`),
    JSON.stringify(newExtensionYy(name), null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Extensions");
  registerResource(yyp, name, `extensions/${name}/${name}.yy`);

  return yyp;
}
