# Cloud project structure sync

## Authority boundary

In an authenticated cloud workspace, Supabase is authoritative for chapters, scene core fields, locations, tags, and scene-tag assignments. Characters, profiles, photos, structural links, people/actions, and emotional-relation adjuncts remain local until their dedicated cloud phase. `?local=1` continues to use the V11 localStorage workflow exclusively.

## Boot and snapshot mapping

`get_project_content` is the single consistent initial read. `hydrateProjectFromCloudSnapshot()` maps database rows to the existing application shape in one place:

- a null database `chapter_id` becomes the virtual `chapter-unassigned` UI chapter;
- `scene_tags` becomes each scene's `tags` ID array;
- database placement/writing statuses become the current UI values;
- dates and times remain strict strings and are not passed through `Date` normalization.

The workspace shows “Загрузка проекта…” until that read finishes. An empty remote snapshot produces the normal empty workspace; it never creates dummy database rows.

## Revision and mutation queue

The active `cloudProjectSync` owns the last server-confirmed project revision. Every mutation is serialized per active project. Operation N uses the confirmed revision, stores only the revision returned by the RPC, then refreshes the consistent snapshot before operation N+1. Confirmed domain state changes only after RPC success. A failed operation stops dependent queued writes until an explicit reload resets the queue.

`REVISION_CONFLICT` is never retried. The current form remains open, its DOM draft remains intact, and the user chooses whether to reload the latest snapshot. Reloading does not close or reset the dirty form.

## Cache and hybrid adjunct

The project namespace remains `authorWorkspace:project:<projectId>`. Confirmed snapshots are cached there through an entity-aware merge. Metadata is kept in the adjacent key `authorWorkspace:project:<projectId>:cloud-cache-meta` with schema version, project ID, cloud revision, and cache timestamp.

Cloud refresh replaces only cloud-authoritative entities. It preserves local characters, profiles, photos, structural links, future fields, and scene adjuncts joined by stable scene ID (`people`, actions, relation changes, and safe not-yet-cloud fields). Cache writes never trigger uploads.

If cloud content is unavailable, the last local copy may be shown only as a clearly labelled, write-disabled recovery view. It is not silently promoted to authority.

## First-open protection

If the cloud snapshot is empty while that project's local namespace contains content, sync is blocked before any cache write. The local data remain available for export and recovery. Automatic local-to-cloud import is deliberately deferred.

## Scene order and sort modal

Compact DnD and the sort modal both submit one semantic `move_scene` operation per completed drag: target chapter plus `beforeSceneId`. The virtual unassigned chapter maps to a null target chapter. The current sort modal has no bulk “apply sort” action, so a bulk reorder RPC is not required: one user drop is one logical mutation and one revision bump.

