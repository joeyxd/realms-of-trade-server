# IC06b: constant memory with seamless continuity (design, T-1025-38)

Owner: AREA17 (area17-market). Design by the chef; builds T-1025-37 (prune), T-1025-39 (long-term memory and continuity), T3 (recall) later.

## What Joi asked (2026-10-25)
- The memory never stops capturing: today the journal (`memory.jsonl`, `MEMORY_MAX_BYTES` 1 MiB) refuses appends at the cap.
- The companion always runs on an optimized prompt (bounded size whatever the history length).
- Continuity across sessions is almost unnoticeable: a new session greets and continues as if it never stopped.
- The companion can recall and search its past sessions when needed.

## Today (origin 6268d0d + 236925c)
- One JSONL journal per companion: `episode` entries (one per remembered turn, server observation + last 4 chat lines + goals + feedback) and `summary` entries (IC06a: model text over 2..8 pinned episodes, id + sha256). `parseMemoryJournal` (server/agent/memory-journal.mjs) validates every line; a summary's sources must appear earlier in the same file.
- The hosted prompt carries only retrieval: `refreshMemoryRetrieval` ranks the live journal (BM25-like on the owner's message, 8 records, 8192 units). No continuity cue: `continuationCue` (server/agent/companion-continuity.mjs) is used only by the PC runtime (tools/agent/local-companion.mjs).
- The hosted transport caps a prompt at 16 KiB (endpoint-openai-transport maxInputBytes default). Any new mandatory context must stay small.

## Design: three layers
1. Live journal (prompt-facing, bounded): one `epoch` entry at the head, then the recent entries. Hard cap 1 MiB unchanged; pruned at 768 KiB down to about 256 KiB.
2. Archive (search-facing, bounded): immutable segments `memory-archive/NNNNNN-<sha16>.jsonl`, each the pruned prefix of the live journal, at most 32 kept (oldest deleted). A segment is itself a valid journal (summaries only reference earlier lines).
3. Long-term memory (always in the prompt, small): the latest digest (a summary of summaries) or, after a prune, the text the epoch carries over.

### Epoch entry (kind `epoch`, v 2, sealed like the others)
`payload = { seq, segment: { name, sha256, bytes, entries }, range: { firstCreatedAtMs, lastCreatedAtMs }, totals: { episodes, summaries, sessions }, carried, pending }`
- `seq` integer >= 1; the segment it names holds the entries it replaced; `totals` are cumulative (previous epoch totals plus this segment).
- `carried` is null or `{ text <= 2000, tags <= 16, certainty inferred|uncertain, sourceIds <= 8 }`: deterministic, no model call. Anchor = the newest entry of the pruned prefix that is the old epoch (its carried) or a digest; then the level-1 summaries after it, chronological; joined with a newline; drop the oldest non-anchor parts until it fits 2000 characters, then cut the anchor from the front. Tags newest first, unique, at most 16. Uncertain if any part is uncertain.
- `pending`: the parsed remembered-action pending rows at the cut (`{ actionId, sourceId }`, at most 64), so pruning never changes `journal.pending`.
- Parser: an epoch is valid only at index 0; its pending rows seed the pending map; it projects to a record "Long-term memory carried over from N archived sessions (model interpretation; revalidate current state). <text>" (certainty = carried certainty, else uncertain).

### Prune (T-1025-37): deterministic, free, never blocks capture
- Pure planner `planMemoryPrune(text, scope, { nowMs, pruneTo, keepEpisodes })` in server/agent/memory-prune.mjs. Cut c over entries E: prefix P = E[0..c), tail T = E[c..n). Valid when no summary in T cites an id in P (closed), T keeps at least 24 episodes, P holds at least one non-legacy entry besides an old epoch, and the pending rows at the cut are at most 64. Pick the smallest valid c that brings the new live file to at most 256 KiB, else the largest valid c; none -> `memory_prune_no_cut`.
- Legacy owner-authored records (v1) in P stay live, right after the new epoch, in their order; they are not archived.
- The planner re-parses the segment and the new live text, checks the pending rows equal the full parse, and refuses otherwise.
- Store `prune()` (server/agent/memory-store.mjs) uses the same lock, fences, revision and hash checks as `remove()`: write the segment (temp, fsync, rename; an existing identical file is reused, a different one is `archive_conflict`), then the live file through the existing temp + rename path, then delete segments beyond 32 (oldest by seq, names matching the pattern only).
- Trigger: after a remembered turn (and its summary), when the live journal is at or over 768 KiB. Status `memory/pruned` or `memory/prune_failed`. Hosted and PC pairing (PairedCompanion) both; the Studio local runtime is a follow-up.
- The center memory line adds the archive: "archivo: N recuerdos en S partes".

### Long-term memory and continuity (T-1025-39)
- Digest = a summary whose sources are summaries (2..8). `summaryValid`, `buildMemoryTurn` and `createMemorySummary` accept summary sources (tags from the sources, uncertain if any source is uncertain). The digest turn carries `policy.longTerm = { previous: { id, text } | null }` (the latest digest or the epoch's carried text) as context, not as a pinned source, so a digest never pins the chain and prune cuts stay closed.
- `MEMORY_INSTRUCTIONS` gains one sentence for long-term turns: fold `policy.longTerm.previous` and the pinned summaries into one text that keeps durable facts (owner's name and preferences, promises, shared plans, relationship), unresolved matters and dates; drop transient detail.
- Hosted trigger: at most one paid memory call per owner turn. Summary first (IC06a rule); otherwise a digest when at least 3 level-1 summaries are not yet covered by a digest, with the same budget guard (at least 2 calls left, nothing inflight, not blocked).
- Continuity cue in the hosted prompt (`required.tools.continuity`, at most 3000 bytes): `longTerm` (<= 1200 chars), `latestSummary` (<= 800), the last 2 chat lines of the latest episode (<= 300 chars each), `newSession` (latest episode's session differs from the current one) and `lastSeenMs`. No goals (the current goals are already required). `continuationCue` stays compatible for the PC runtime.

### Recall (T3, after T-1025-39)
- Automatic: when the live retrieval matches fewer than 2 records for the owner's message, search the newest 4 archive segments with the same scorer and add the top 3 as optional memory (cached per segment sha256; segments are immutable).
- Explicit: a `recall_memory { query }` conversation decision; the mind searches the live journal and the whole archive chain and makes one follow-up call with the hits (reply or wait only). Only with at least 2 calls left.

## Budget (T-1025-36, shipped with this design)
- The owner picks the calls per 2-hour window in the center (1..60, default 20; src/net/hostedInference.js HOSTED_CALLS). PC pairing keeps 8.
- A closed window, a new calls setting or an edited companion opens a fresh window on the next start over the same memory (before: the companion went silent forever after its first 2 hours, and any edit made the start fail).
