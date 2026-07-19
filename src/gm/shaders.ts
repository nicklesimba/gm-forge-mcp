import { promises as fs } from "fs";
import path from "path";
import type { Yyp } from "@bscotch/yy";
import { ensureFolder, validateResourceName, RESOURCE_VERSIONS, registerResource, assertSafeResourceName, fileExists } from "./yyp.js";

const DEFAULT_VERTEX_SHADER = `attribute vec3 in_Position;
attribute vec4 in_Colour;
attribute vec2 in_TextureCoord;

varying vec2 v_vTexcoord;
varying vec4 v_vColour;

void main()
{
    vec4 object_space_pos = vec4(in_Position.x, in_Position.y, in_Position.z, 1.0);
    gl_Position = gm_Matrices[MATRIX_WORLD_VIEW_PROJECTION] * object_space_pos;

    v_vColour = in_Colour;
    v_vTexcoord = in_TextureCoord;
}
`;

const DEFAULT_FRAGMENT_SHADER = `varying vec2 v_vTexcoord;
varying vec4 v_vColour;

void main()
{
    gl_FragColor = v_vColour * texture2D(gm_BaseTexture, v_vTexcoord);
}
`;

/**
 * Add a new shader (vertex + fragment pair) to the project. type 1 = GLSL ES,
 * the standard cross-platform default GameMaker's own IDE uses for new shaders.
 */
export async function addShader(
  projectDir: string,
  yyp: Yyp,
  shaderName: string,
  vertexCode: string = DEFAULT_VERTEX_SHADER,
  fragmentCode: string = DEFAULT_FRAGMENT_SHADER
): Promise<Yyp> {
  validateResourceName(yyp, shaderName);

  const dir = path.join(projectDir, "shaders", shaderName);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(dir, `${shaderName}.vsh`), vertexCode, "utf8");
  await fs.writeFile(path.join(dir, `${shaderName}.fsh`), fragmentCode, "utf8");

  const shaderYy = {
    "$GMShader": "",
    "%Name": shaderName,
    name: shaderName,
    parent: {
      name: "Shaders",
      path: "folders/Shaders.yy"
    },
    resourceType: "GMShader",
    resourceVersion: RESOURCE_VERSIONS.shader,
    type: 1
  };

  await fs.writeFile(
    path.join(dir, `${shaderName}.yy`),
    JSON.stringify(shaderYy, null, 2),
    "utf8"
  );

  ensureFolder(yyp, "Shaders");

  registerResource(yyp, shaderName, `shaders/${shaderName}/${shaderName}.yy`);

  return yyp;
}

export interface ShaderEditOptions {
  vertexCode?: string;
  fragmentCode?: string;
}

/**
 * Edit an existing shader's vertex/fragment code. Only touches the .vsh/.fsh
 * files -- the .yy descriptor and catalog registration never change since
 * neither depends on the shader source.
 */
export async function editShader(
  projectDir: string,
  shaderName: string,
  options: ShaderEditOptions
): Promise<void> {
  assertSafeResourceName(shaderName);
  const dir = path.join(projectDir, "shaders", shaderName);
  const vshPath = path.join(dir, `${shaderName}.vsh`);
  if (!(await fileExists(vshPath))) {
    throw new Error(`Shader "${shaderName}" does not exist (expected ${vshPath})`);
  }

  if (options.vertexCode !== undefined) await fs.writeFile(vshPath, options.vertexCode, "utf8");
  if (options.fragmentCode !== undefined) await fs.writeFile(path.join(dir, `${shaderName}.fsh`), options.fragmentCode, "utf8");
}
