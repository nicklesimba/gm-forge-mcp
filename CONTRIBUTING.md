# Contributing

## Setup

```bash
npm install
npm run dev    # runs the server directly via tsx
npm test       # runs the regression suite
```

## Testing expectations

New write paths need a regression test in `test/verify.ts`. The existing tests compare writer output against key-sets captured from real GameMaker files; follow that pattern instead of asserting on a few hand-picked fields. Cover the omitted/default case too, not just the fully-populated one.

Open the affected project in the IDE after your change. If you can't, say so in the PR.

## Code style

Lean and sparsely commented. Comments are for GameMaker quirks and constraints you can't see from the code, not for describing what the next line does.

## Architecture

One module per resource type under `src/gm/`. Shared helpers (`registerResource`, `ensureFolder`, `parseGameMakerJson`, ...) live in `src/gm/yyp.ts`. `src/index.ts` holds tool definitions and dispatch only; logic belongs in `src/gm/`.

## PRs

Open an issue first for anything bigger than a small fix. One change per PR. `npm test` must pass.
