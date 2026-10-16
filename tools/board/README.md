# Marea Negra board

An HTML control room for every area of the project: one illustrated card per area (what it is
for, where we are, what is next, task progress), a voyage route of milestones, a table view and
a detail drawer. The page is `docs/board/index.html`; it opens straight from disk (file://).

## Sources and merge order

`tools/board/build.mjs` writes `docs/board/board-data.js` (`window.MN_BOARD = {...};`) from three
sources. Later sources win:

1. `tools/board/areas.json` - hand-curated: id, code, name, milestone, image, purpose,
   first_message, order, roadmap_row.
2. `ROADMAP.md` (workspace root) - milestone table, area rows (title, worktree, branch, last
   commit, plan docs, built, state, next) and the "Where we are" line.
3. `<workspace>/<area id>/context/NOW.md` - ticket, updated date, Goal, State, Next, Open. When
   present, its Next bullets become the area's tasks; otherwise the ROADMAP Next cell is split
   on "; ".

The live `/status` of the server adds `meta.live_version` (field `version`). It carries no
protocol field today, so the protocol number comes from the ROADMAP "Live:" bullet. If the
server cannot be reached the build falls back to that bullet and says `live fallback`.

## Refresh

- Double-click `TABLERO.cmd` (builds, then opens the page), or run `npm run board`.
- Flags: `--no-live` (skip the fetch), `--workspace <path>`, `--status-url <url>`.

## Images

The card pictures are 960 px WebP files in `docs/board/img/`, converted from the 1536x1024 PNG
masters (the PNGs are never committed):

    npm run board:images -- --src <folder with the PNGs>

Options: `--width 960`, `--quality 82`. Needs Python 3 with Pillow.

## Hosted copy

The same `index.html` is published as the claude.ai artifact, with `board-data.js` and `img/`
as its files. There the artifact database overlays the live marks (status, today, tickets,
state, next, tasks, images, milestone status) on the file data by id, and the write controls
(Today, task status, add task, image upload) work. From file:// the write controls are
disabled and the chip reads "file copy".

## Gotchas

- `ROADMAP.md` lives in the workspace root, one level above the repo checkout. The build finds
  it from the script location, not from the current folder.
- `context/NOW.md` files are git-ignored and live only in the worktrees. Rebuild from a machine
  that has them, or the cards fall back to the ROADMAP text.
