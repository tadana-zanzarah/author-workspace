# Cloud Content API Contract

`js/cloud-content-api.js` is the only frontend infrastructure entrypoint for these RPCs. It is wired into authenticated cloud workspaces through `js/cloud-project-sync.js`; chapters, scene core fields, locations, tags, and scene tags are Supabase-authoritative there. Character participation and other character-derived scene fields remain local adjuncts. `?local=1` remains entirely localStorage-backed.

Every mutation receives `projectId` and `expectedRevision`. A changed success returns `{ok:true, code:"OK", revision, changed:true, data}`. A semantic no-op returns the unchanged revision and `changed:false`. A conflict returns `{ok:false, code:"REVISION_CONFLICT", expectedRevision, actualRevision}`. The API never retries a conflict and never asks callers to parse PostgreSQL messages.

Available methods are `loadProjectContent`, chapter create/update/delete/reorder, location create/update/delete, tag create/update/delete, scene create/update/delete/move, and `setSceneTags`. UI code calls these methods through the serialized project mutation queue instead of scattering raw `client.rpc()` calls.

The snapshot contains `project`, `chapters`, `locations`, `tags`, `scenes`, and `scene_tags`. Characters, scene participants, emotional relation changes, structural links, and images remain outside this phase.
# Cloud character API

`js/cloud-character-api.js` is a separate, currently unused Data API adapter. Production editors remain localStorage-backed.

Global reads are `list_characters()` and `list_global_character_links()`. Identity mutations are `create_character`, `update_character`, and `archive_character`; callers retain and send `characterRevision`. Identity creation does not attach to a project or bump any project.

Project operations are `attach_project_character`, atomic `create_character_and_attach`, `update_project_character`, and `remove_project_character`. The atomic create-and-attach transaction leaves neither an orphan identity nor membership if it fails and consumes exactly one project revision on success.

Set replacement APIs are `set_scene_characters`, `set_project_character_relations`, and `set_scene_relation_changes`. They validate the complete input before writes, compare deterministic semantic representations, and consume one project revision only when the resulting set differs. Duplicate IDs/pairs are rejected.

Structural links use `create_character_link`, `update_character_link`, and `delete_character_link`. Global create needs no arbitrary project token; subsequent global mutations use `linkRevision`. Project links use `expectedProjectRevision`. Self/cross-owner links and exact or reversed semantic duplicates are rejected, while meaningfully different links between the same pair remain valid.

`get_project_content` now returns a single project-revision snapshot containing `project_characters`, `scene_characters`, `project_character_relations`, `scene_relation_changes`, and project `character_links`, in addition to the existing chapter/location/tag/scene data. Global identities and links are loaded separately with their own revisions.

The JS adapter maps SQL results to safe codes and never exposes raw Postgres text: `REVISION_CONFLICT`, `CHARACTER_REVISION_CONFLICT`, `GLOBAL_LINK_REVISION_CONFLICT`, `DEPENDENCIES_EXIST`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `DUPLICATE`, and `UNKNOWN`. Stale writes are never retried automatically.
