# Contributing

## Setup

```bash
npm install
npm run dev    # runs the server directly via tsx
npm test       # runs the regression suite
```

## The bar

This tool's only real promise is that it never leaves a GameMaker project broken. That means:

- Every writer's output is checked against a real GameMaker-authored reference (key-sets captured from an actual project, or `@bscotch/yy`'s schemas where no example exists) -- not just "looks plausible."
- New write paths need a regression test in `test/verify.ts`: structural correctness, relevant edge cases (e.g. a field that's legally omitted), and ideally a real-IDE or `lint_project`/`compile_project` check.
- If you can run GameMaker locally, verify by actually opening the affected project after your change. If you can't, say so in the PR -- don't claim it's tested when it wasn't.

## Code style

Lean and uncommented by default. A comment is only worth adding when it explains a non-obvious *why* (a real bug it fixes, a GameMaker quirk, a constraint that isn't visible from the code itself) -- not what the code does.

## Architecture

Each resource type has its own module under `src/gm/` (`rooms.ts`, `scripts.ts`, `objects.ts`, ...), generally split into pure descriptor-building functions and I/O orchestration. Shared helpers (`registerResource`, `ensureFolder`, `ensureAudioGroup`, `ensureTextureGroup`, `parseGameMakerJson`) live in `src/gm/yyp.ts`. `src/index.ts` is just MCP tool definitions + dispatch -- logic belongs in `src/gm/`.

## PRs

Open an issue first for anything beyond a small fix. Keep PRs scoped to one change; `npm test` must pass.
