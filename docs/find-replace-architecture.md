# Find / Replace — architecture

Status: **Stage A only** (atomic cloud persistence foundation) is implemented.
No matching engine, panel, keyboard shortcuts, highlighting, mounted-scene
registry, navigation, or any user-facing Find/Replace behavior exists yet.
This document records the decisions those later stages must follow; it is
deliberately not a full UI spec — unfinished UI details are not documented
here until they're built.

## Two different operations, not one mechanism

Find/Replace has two distinct kinds of "Replace All," with different
atomicity guarantees. Later stages must keep this distinction explicit in
both code and UX:

- **Current-scene Replace / Replace All** — edits one open editor's live
  ProseMirror state as a single transaction (one Undo step via the normal
  `prosemirror-history` plugin). Persistence rides whichever surface's
  existing Save flow already exists (`update_scene_text`); Find/Replace adds
  no new persistence path for this case.
- **Project-wide ("Весь проект") Replace All** — a committed, project-level
  operation with its own preview/confirmation, gated on a **synchronized**
  text state (see below), and persisted atomically via `bulk_update_scene_text`
  (cloud) or a single `commitDataChange` (local). It is **not** represented as
  an editor Undo step in any open surface — an author pressing Ctrl+Z in an
  editor afterward undoes their own last real edit before the operation, never
  the project-wide operation itself.

## Project scope = all active project scenes

**"Весь проект"** search/replace scope covers every active (non-deleted)
scene belonging to the project, **regardless of `scene.included`** — it does
not inherit `includedScenes()`/"Весь текст" export semantics. Excluded scenes
are still project content and may be re-enabled later; a project-wide rename
must be able to reach stale terms in them.

This required no new filtering/placement logic: `get_project_content` already
never returns soft-deleted scenes to the client, so `data.scenes` already *is*
"all active scenes." Every scene always carries a `chapterId` (a real chapter
or the reserved `chapter-unassigned` pseudo-chapter), so canonical project
order — chapters in stored order, then scenes within each chapter in stored
order — already covers every active scene with no unrepresented case.

## Project-wide Replace All requires synchronized state before it can commit

Project-wide Replace All may commit **only** from a state where every scene it
will touch is confirmed synchronized between whatever's live in an open editor
and what's persisted. It must never write from one editor's live state via one
path while writing another scene via a different path — that reintroduces
partial-commit risk even if each individual write is itself safe.

Required flow for a later stage:

1. Compute the live preview (match/scene counts) against each affected
   scene's live doc if it's open somewhere, persisted doc otherwise.
2. Before committing, check every affected scene's **text doc specifically**
   for divergence between its live and persisted state. **This check operates
   at the ProseMirror-doc level only** — comparing `docToJSON` of the live doc
   against `docToJSON(loadSceneDocument(schema, persistedScene))`, the same
   primitive `saveAllScenes()` already uses. It never reads a whole-surface
   dirty-tracker (e.g. `trackerFor("sceneModal")`).
3. **If any affected scene's text is unsynchronized, do not proceed.** Offer
   to save first. That "save" is **text-only**:
   - persist exactly `scene_text` + `metadata.richText` through the existing
     `updateSceneText`/`update_scene_text` semantics (same narrow RPC T1
     already uses for the standalone/Scene-modal/"Весь текст" text saves);
   - **never** programmatically invoke a surface's full Save action (e.g. the
     Scene modal's Save button also persists title/chapter/participants/tags —
     Find/Replace must not silently save those to synchronize text);
   - leave every unrelated dirty form field dirty and unsaved;
   - after a successful text-only save, rebase **only** the text/doc portion
     of that surface's dirty-state baseline (a targeted patch, not a full
     `captureInitialState()`, which would wrongly clear unrelated pending
     field edits) — this needs a small, narrowly-scoped addition to
     `js/dirty-state.js` when that stage is built; it does not exist yet.
4. Re-derive the match set/preview fresh against the now-synchronized state —
   never reuse pre-save positions or counts.
5. Re-check synchronization once more, synchronously, immediately before
   building the commit payload (closing the window between step 3 and commit).
6. Capture `expected_revision` at this point (after any step-3 saves already
   advanced it), build the final per-scene values from persisted/confirmed
   data only, and send them **atomically**:
   - **Cloud:** one `bulk_update_scene_text` call.
   - **Local:** one `commitDataChange` covering every affected scene.
7. On `REVISION_CONFLICT` or any failure: zero replacement writes, no partial
   state, no auto-retry — report and require reload/redo.
8. On success: sync every mounted view of an affected scene to the committed
   result via a `tr.setMeta("addToHistory", false)` transaction (so it never
   becomes an Undo step), and rebase only that scene's text baseline the same
   way step 3 does.

## Mounted-scene registry (not built yet) must support multiple live views per scene

When a later stage builds the shared mounted-scene registry that both live
search and project-wide sync will depend on, it must **not** be
`Map<sceneId, singleEntry>`. The same scene can legitimately be open in more
than one surface/registration at once (e.g. the standalone editor and an
instance inside "Весь текст"). Use a structure keyed by scene id that holds a
**collection** of registrations, e.g. `sceneId -> Map<registrationId, {view,
surfaceId, activate()}>`. A project-level synchronization (step 8 above) must
update **every** live registration for an affected scene, never just
whichever one happened to be registered last. This is recorded here as an
accepted invariant for whichever stage implements the registry — it is not
implemented in Stage A.

## v1 case-insensitive matching: `toLowerCase()`, not `toLocaleLowerCase()`

When the matching engine is built (Stage B), case-insensitive comparison uses
`String.prototype.toLowerCase()` (Unicode default case conversion), **not**
`toLocaleLowerCase()`. The same project and the same query must not produce
different match results merely because two users' browsers report different
locales. This is a deliberate departure from `js/filters.js`'s existing
`.toLocaleLowerCase("ru")` (scene-list filtering, a different, older feature
not being changed here). A future project/scene language setting may add
locale-aware casing as an explicit, opt-in layer later — it is not part of v1
and the engine must not be built in a way that assumes it.

No ё/е folding, in v1 or later — they remain distinct characters.

## NFC comparison needs position mapping (Stage B, not built yet)

Blind whole-string `.normalize('NFC')` before searching, then reusing indices
found in the normalized string as ProseMirror positions, is rejected —
normalization can change code-unit length locally (e.g. a base letter +
combining diacritic composing into one precomposed character), desynchronizing
any such index from the original text. The matching engine must instead
normalize per grapheme cluster (e.g. via `Intl.Segmenter`) while recording,
for every output comparison character produced, the original source `[start,
end)` span that produced it — then map a found match back through that
provenance table to the real source range before touching the document. Test
coverage for this (when built) must include: precomposed vs. combining
equivalents, Cyrillic, Latin, case-sensitive vs. case-insensitive, a match
adjacent to/spanning a mark boundary, and a replacement executed via the
mapped original range.

## `bulk_update_scene_text` — what exists today (Stage A)

`supabase/migrations/20260910120000_scene_text_bulk_update.sql` adds one new
RPC:

```
bulk_update_scene_text(target_project_id uuid, expected_revision bigint, replacements jsonb)
```

It is a **generic atomic bulk writer**, not Find/Replace-aware — it has no
matching/searching logic. `replacements` is a JSON array of already-computed
final values: `{scene_id, scene_text, metadata}`. Contract:

- Auth/ownership conventions match `update_scene_text` exactly (`security
  invoker`, project row locked and ownership-checked via `auth.uid()`, `anon`
  denied execute, `authenticated` granted).
- The project's `expected_revision` is checked **once** for the whole batch.
- Every targeted scene must belong to `target_project_id` and be
  non-deleted; `metadata` must be a JSON object; `scene_id` must be a valid
  UUID; duplicate `scene_id` values in one call are rejected.
- `scene_text` + `metadata` are written together per scene (same
  set-not-merge metadata contract as `update_scene_text` — `metadata` is fully
  replaced, never deep-merged).
- `projects.revision` bumps **exactly once** if the batch produced any actual
  change; an all-semantic-no-op batch bumps nothing.
- An empty `replacements` array is a defined, safe no-op.
- **Atomicity**: implemented as two passes — pass one validates and resolves
  every element (no writes), pass two writes every row only once every
  element has already been confirmed valid. This gives specific error codes
  (`VALIDATION_ERROR`/`DUPLICATE`/`NOT_FOUND`/`REVISION_CONFLICT`) for every
  expected failure while still guaranteeing that an invalid element anywhere
  in the array — including after earlier, individually-valid elements —
  results in zero writes. The write pass still `RAISE EXCEPTION`s (aborting
  and rolling back the whole call) on a defensive backstop case that should be
  unreachable given the project row is held locked from before validation
  begins. See `supabase/tests/cloud_scene_text_bulk_update_rpc.sql`.
- `REVISION_CONFLICT` is surfaced like every other project-scoped mutation and
  must never be retried automatically by any caller.

`js/cloud-content-api.js` exposes `bulkUpdateSceneText(projectId,
expectedRevision, replacements)` following `updateSceneText`'s own adapter
conventions. **Neither the RPC nor the adapter is wired into any save flow or
UI yet** — Stage A only establishes and tests the primitive itself.

The migration has **not** been applied to any database (local or production).
It has been validated via the repository's disposable-CI pattern (see
`.github/workflows/scene-text-bulk-update-ci.yml`), not against a live
Supabase project. Production apply requires the full workflow in
[supabase-workflow.md](supabase-workflow.md) plus explicit per-migration
approval, and is out of scope until a later stage actually needs the RPC live.
