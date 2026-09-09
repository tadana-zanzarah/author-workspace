# Text formatting T1 — persistence decision

Scope: the single-scene rich-text editor (`#textModal` / `#fullSceneText`) only.
See the architecture audit for the full survey this decision is based on.

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

## Coexistence with the still-plain-text Scene modal

T1 intentionally leaves the main Scene modal (`#sceneText`) and "Все
сцены"/"Весь текст" (`#allScenesModal`) as plain textareas. If a Scene
already has a `sceneTextDoc` and is then edited through one of those plain
surfaces, `preservedSceneTextDoc()` (`js/app.js`) / the equivalent guard in
`saveAllScenes()` (`js/import-export.js`) compares the newly typed plain text
against the existing doc's own extracted plain text:

- unchanged → the rich document is kept as-is;
- changed → the now-stale rich document is dropped (locally: the scene's
  `sceneTextDoc` becomes `null`; in cloud mode: a follow-up `update_scene_text`
  call clears `metadata` to `{}` after the normal `update_scene` save
  succeeds) rather than silently left inconsistent with the prose it no
  longer describes.

No prose character is ever lost by this — the plain textarea's value is
exactly what gets saved either way. Only formatting can be lost, and only
when the author genuinely edited the text somewhere that cannot represent
formatting.

## Migration/RPC status

`20260909120000_scene_rich_text.sql` is written and reviewed on this branch.
**It has not been applied to any database** (no local Supabase/Docker
instance was available in this environment to apply and exercise it against
real Postgres, and applying to production is out of scope for this task).
`npm test` covers the client-side contract (schema/serialization,
`sceneTextDocPlainText`, the RPC argument shape via a mocked `rpc()`) but not
the SQL function body itself. This should be run through the project's normal
disposable-CI + read-only pre-flight workflow (`docs/supabase-workflow.md`)
before any production apply is requested.
