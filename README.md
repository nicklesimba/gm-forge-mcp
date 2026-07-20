<p align="center">
  <img src="assets/logo.svg" width="120" alt="gm-forge-mcp logo" />
</p>

<h1 align="center">gm-forge-mcp</h1>

<p align="center">
  <a href="https://github.com/nicklesimba/gm-forge-mcp/actions/workflows/ci.yml"><img src="https://github.com/nicklesimba/gm-forge-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/nicklesimba/gm-forge-mcp" alt="License"></a>
</p>

gm-forge-mcp is an MCP server that lets an AI assistant create and edit GameMaker projects: scripts, objects, rooms, sprites, sounds, and the rest of the `.yyp` catalog. In practice that means you can ask Claude to scaffold a new project, import a folder of sprite frames, or rename an object everywhere it's referenced, and the project still opens in the IDE afterwards.

> Early stage (0.1.0) - back up your project before letting anything write to it.

GameMaker's file format punishes sloppy edits quietly. A room missing its `creationCodeFile` field, or a sound whose declared sample rate doesn't match the real `.wav`, can look fine right up until the IDE fails to open the project or crashes. Every writer here is modeled on files GameMaker itself produced, and two tools use GameMaker's own tooling directly: `lint_project` runs the official headless validator (ProjectTool) and `compile_project` runs the real compiler (Igor), which catches actual GML errors.

## Requirements

- Node.js 20+
- GameMaker (Windows) for `lint_project`'s ProjectTool check and for `compile_project`. Both skip with a clear message when GameMaker isn't installed; everything else works cross-platform.

## Install

```bash
git clone https://github.com/nicklesimba/gm-forge-mcp.git
cd gm-forge-mcp
npm install
npm run build
```

## Configure

Add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gm-forge": {
      "command": "node",
      "args": ["/absolute/path/to/gm-forge-mcp/dist/index.js"]
    }
  }
}
```

## Tools

**Projects** -- `create_project`, `list_resources`, `find_references`, `delete_resource`, `rename_resource`, `lint_project`, `compile_project`

**Groups** -- `add_texture_group`, `add_audio_group`

**Scripts** -- `add_script`, `edit_script`, `get_script_info`

**Objects** -- `add_object`, `add_object_event`, `get_object_info`

**Rooms** -- `add_room`, `edit_room`, `add_room_instance`, `reorder_room`, `move_room_relative`, `get_room_info`

**Sprites** -- `add_sprite_from_images`, `edit_sprite`, `get_sprite_info`

**Tilesets** -- `add_tileset`, `edit_tileset`, `get_tileset_info`

**Sounds** -- `add_sound`, `edit_sound`, `get_sound_info`

**Shaders** -- `add_shader`, `edit_shader`, `get_shader_info`

**Fonts** -- `add_font`, `edit_font`, `get_font_info`

**Notes** -- `add_note`, `get_note_info`

**Extensions** -- `add_extension`, `get_extension_info`

**Particle systems** -- `add_particle_system`, `get_particle_system_info`

**Animation curves** -- `add_anim_curve`, `get_anim_curve_info`

`delete_resource` and `rename_resource` search the whole project for references before touching anything.

## Testing

```bash
npm test
```

The suite checks every writer's output against reference schemas captured from real GameMaker files, simulates files GameMaker has resaved (trailing commas and all), and runs live ProjectTool/Igor checks when those are installed. CI runs on a Windows runner without GameMaker, so the live checks skip there and the summary reports the skip count. Every resource type has also been loaded in the actual IDE, including a project created from scratch by `create_project`.

## See also

[GameMaker](https://gamemaker.io) is required to use any of this. Thanks to YoYo Games for making game-making more accessible for two decades and counting!

[@petah/gamemaker-mcp](https://www.npmjs.com/package/@petah/gamemaker-mcp)  <img width="40" height="37" alt="image" src="https://github.com/user-attachments/assets/a8f0c4ef-8906-4135-a292-0aeb87856579" />
covers GML function/API reference lookup, which this project doesn't.

## License

MIT - see [LICENSE](LICENSE).
