# Text formatting T1/T2 — persistence decision

Scope: originally the single-scene rich-text editor (`#textModal` /
`#fullSceneText`) only; T2 propagated the same editor/document model
(unchanged persistence contract below) to the regular Scene modal
(`#sceneModal`) and "Весь текст" (`#allScenesModal`) — see "Coexistence"
below, updated for T2. See the architecture audit for the full survey this
decision is based on.

## What was rejected

The architecture audit's own draft recommendation — store serialized
ProseMirror JSON directly inside the existing `sceneText`/`scene_text` field —
was **not** implemented. Before touching persistence, every real consumer of
that field was traced:

- word count (`countWords(scene.sceneText)` in `js/render.js`, `js/characters.js`)
- full-text search (`js/filters.js`, joins `scene.sceneText` into the searchable string)
- `.doc` export (`exportWholeText` in `js/import-export.js`, splits on `\n`, wraps each line in `<p>`)
- `storageProjectScore` (`js/storage.js`, treats `sceneText.length` as a plain size proxy)
- legacy `text` → `sceneText` coercion (`normalizeProject` in `js/migrations.js`)
- local→cloud migration and every `sceneToCloud`/RPC call site

All of these assume `sceneText` is plain prose. Turning it into a JSON string
would have silently broken word counts, search relevance, the `.doc` export's
line-per-paragraph logic, and the size heuristic — an "ambiguous, sometimes
prose sometimes JSON" field, exactly what the task asked to avoid.

## What was implemented instead

`sceneText` / `scene_text` keeps its existing contract: it is always the
**plain-text extraction** of the current document (`docToPlainText()` in
`js/editor/scene-doc-convert.js`), regenerated on every save. Every existing
consumer above needs zero changes.

The structured ProseMirror document is stored separately:

- **Local mode**: a new scene field, `sceneTextDoc` (nullable). Local storage
  is one JSON blob with no fixed schema enforced by a database, so this is not
  a migration — `normalizeProject`/`prepareProject` (`js/migrations.js`)
  normalize and validate it like every other scene field, and `safeOwnCopy`
  strips prototype-pollution keys the same way it already does for the rest
  of the project.
- **Cloud mode**: the *already-existing* `public.scenes.metadata jsonb`
  column (added in `20260821133800_cloud_content_schema_foundation.sql`,
  never written by any RPC until now). No `ALTER TABLE` was needed. A new,
  narrowly-scoped RPC, `update_scene_text` (see
  `20260909120000_scene_rich_text.sql`), writes `scene_text` and `metadata`
  together, atomically, so the two can never end up out of sync from a
  partial failure. It deliberately does **not** extend `update_scene`'s
  signature — this mirrors the codebase's own existing precedent (see the
  `createLocationCanonical` comment in `js/cloud-content-api.js`) of adding a
  new RPC rather than overloading one whose contract already has callers.
  `metadata` is currently fully owned by this feature (nothing else uses
  `scenes.metadata` yet) — the RPC *sets* it rather than merging; a future
  feature that also needs `scenes.metadata` should switch this to a merge.

## Backward compatibility

A scene with no `sceneTextDoc` (every existing scene today) is legacy plain
text. `loadSceneDocument()` converts it to a document with exactly one
paragraph per `\n`-separated line (blank lines included, as empty
paragraphs) — a lossless mapping: `docToPlainText(loadSceneDocument(schema,
scene))` reproduces the original string exactly when nothing was changed. No
literal legacy characters (`<b>`, `<center>`, `***`, stray angle brackets)
are ever auto-interpreted as structure; they stay literal text inside a
plain paragraph unless a future, separate, opt-in conversion tool says
otherwise.

A `sceneTextDoc` that fails to parse against the current schema (corrupted,
or from an incompatible future version) is never fatal: `loadSceneDocument()`
catches the failure and falls back to the plain-text `sceneText`, so the
editor can never crash on load and prose is never lost — only formatting
metadata that could not be trusted is dropped.

## Coexistence with the Scene modal and "Весь текст" (T1 → T2)

T1 intentionally left the main Scene modal (`#sceneText`) and "Все
сцены"/"Весь текст" (`#allScenesModal`) as plain textareas. Because a Scene
already carrying a `sceneTextDoc` could still be edited as plain text through
either of those surfaces, T1 shipped a temporary guard:
`preservedSceneTextDoc()` (`js/app.js`) and the equivalent inline check in
`saveAllScenes()` (`js/import-export.js`) compared the newly typed plain text
against the existing doc's own extracted plain text (via
`sceneTextDocPlainText()`) and dropped (nulled) the now-stale rich document
whenever it no longer matched, rather than leaving it silently inconsistent.

**T2 removed this guard.** Both surfaces now mount the same ProseMirror editor
(`mountSceneEditor()` for the single-scene Scene modal; a new
`createSceneEditorGroup()` — one shared toolbar, N independent per-scene
documents — for "Весь текст"). Every save from any of the three surfaces now
produces a real, editor-derived `sceneTextDoc` directly (never a
plain-text-only write with no accompanying doc), so there is no longer a
"stale doc vs. plain text" case for the guard to protect against.
`preservedSceneTextDoc()` and the `saveAllScenes()` stale-clearing branches
were deleted, and `sceneTextDocPlainText()` (the primitive they were built
on) was removed as dead code once nothing referenced it. All three surfaces
share one persistence contract:

- `sceneText`/`scene_text`: always the plain-text projection of the current
  document (`docToPlainText()`), regenerated on every save.
- `sceneTextDoc`/`metadata.richText`: the structured document, written via
  the same narrow `update_scene_text` RPC from all three surfaces.
- "Весь текст" additionally only writes scenes whose structured document
  actually changed (including formatting-only changes) — see
  `saveAllScenes()`'s baseline comparison against
  `docToJSON(loadSceneDocument(schema,scene))`.

## Migration/RPC status

`20260909120000_scene_rich_text.sql` is written and reviewed on this branch.
**It has not been applied to any database** (no local Supabase/Docker
instance was available in this environment to apply and exercise it against
real Postgres, and applying to production is out of scope for this task).
`npm test` covers the client-side contract (schema/serialization, the RPC
argument shape via a mocked `rpc()`) but not the SQL function body itself.
This should be run through the project's normal
disposable-CI + read-only pre-flight workflow (`docs/supabase-workflow.md`)
before any production apply is requested.
