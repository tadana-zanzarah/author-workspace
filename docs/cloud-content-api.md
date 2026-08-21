# Cloud Content API Contract

`js/cloud-content-api.js` is the only frontend infrastructure entrypoint for the RPCs in this phase. It is intentionally not wired into the workspace yet; production content remains in the current per-project `localStorage` namespace.

Every mutation receives `projectId` and `expectedRevision`. A changed success returns `{ok:true, code:"OK", revision, changed:true, data}`. A semantic no-op returns the unchanged revision and `changed:false`. A conflict returns `{ok:false, code:"REVISION_CONFLICT", expectedRevision, actualRevision}`. The API never retries a conflict and never asks callers to parse PostgreSQL messages.

Available methods are `loadProjectContent`, chapter create/update/delete/reorder, location create/update/delete, tag create/update/delete, scene create/update/delete/move, and `setSceneTags`. Future UI code must call these methods instead of scattering raw `client.rpc()` calls.

The snapshot contains `project`, `chapters`, `locations`, `tags`, `scenes`, and `scene_tags`. Characters, scene participants, emotional relation changes, structural links, and images remain outside this phase.
