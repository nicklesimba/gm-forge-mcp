<p align="center">
  <img src="assets/logo.svg" width="120" alt="gm-forge-mcp logo" />
</p>

<h1 align="center">gm-forge-mcp</h1>

<p align="center">MCP server for creating and editing GameMaker projects -- built to never break the project it's editing.</p>

> Early stage (0.1.0). The write paths are tested and real-IDE-verified (see Testing below), but back up your project before pointing any tool at it, as with any early-stage software that touches your files.

44 tools across 12 resource types, including: creating a working project entirely from scratch, importing sprite frames with correct per-layer source data, safe rename/delete with full reference tracking, room reordering, and two integrations with GameMaker's own official tooling -- `lint_project` runs GameMaker's headless validator (ProjectTool), and `compile_project` runs GameMaker's real compiler (Igor) to catch actual GML errors, not just structural ones.

Every write path is checked against real GameMaker `.yy`/`.yyp` output. That matters because hand-editing these files wrong doesn't always fail loudly -- a room saved without a `creationCodeFile` field, or a sound whose declared sample rate doesn't match its real `.wav` header, both load "fine" until GameMaker's own validator or audio engine hits them, at which point the project can fail to open or crash outright. Both are real bugs this project ran into and now checks for automatically.

## Requirements

- Node.js 20+
- GameMaker (Windows) for `lint_project`'s ProjectTool check and for `compile_project` -- both skip gracefully with a clear message if GameMaker isn't installed. Everything else works cross-platform.

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

`delete_resource` and `rename_resource` check every reference across the whole project first, so nothing is silently orphaned or left dangling.

## Testing

```bash
npm test
```

223 regression checks against reference schemas captured from real GameMaker output, plus live integration checks against ProjectTool and Igor when they're installed (CI runs on Windows without GameMaker installed, so those specific checks skip there -- the run summary reports the skip count explicitly rather than hiding it).

Beyond the automated suite, every writer has been verified against the real GameMaker IDE: resources of every supported type created (and edited) by these tools load cleanly in the actual editor, and a project built 100% from scratch by `create_project` opens and compiles without ever having been touched by the IDE first.

## See also

[@petah/gamemaker-mcp](https://www.npmjs.com/package/@petah/gamemaker-mcp) -- if you need GML function/API reference lookup (not something this project covers), that's a solid tool for it.

## License

MIT -- see [LICENSE](LICENSE).
