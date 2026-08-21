# Cloud Content Schema

Implemented by `20260821133800_cloud_content_schema_foundation.sql` and
`20260821134302_harden_cloud_content_indexes.sql`. The schema is present in the
Author Workspace Supabase project but is not used by the production UI yet.

## Existing foundation changes

`projects.revision` was widened from `integer` to `bigint` without changing
values or its default (`0`). It is the only project-content concurrency counter;
no `content_version` exists. Revision increments and compare-and-swap RPCs are
deferred to the cloud content transaction phase. `(owner_id, id)` is now unique
on projects to support ownership-safe composite references.

## Tables and ownership

| Table | Ownership route | Important relationships |
| --- | --- | --- |
| `characters` | direct `owner_id` | reusable account identity; delete restricted while referenced |
| `project_characters` | project -> owner | project CASCADE, character RESTRICT; unique project/character |
| `chapters` | project -> owner | project CASCADE |
| `locations` | project -> owner | project CASCADE |
| `tags` | project -> owner | unique `(project_id, normalized_name)` |
| `scenes` | project -> owner | chapter/location composite FKs; both nullable |
| `scene_tags` | scene -> project -> owner | same-project composite FKs; composite PK |
| `scene_characters` | scene -> project -> owner | same-project composite FKs; composite PK |
| `project_character_relations` | project -> owner | directed, same-project endpoints, unique directed pair |
| `scene_relation_changes` | scene -> project -> owner | directed, same-project endpoints and scene |
| `character_links` | direct owner, optionally project | one table for global (`project_id NULL`) and scoped links |
| `character_images` | character -> owner | optional project-character context must depict same identity |

All UUID roots have generated defaults. User-editable roots contain timestamps;
important recoverable entities use `archived_at`, `removed_at`, or `deleted_at`
as specified by the architecture. Join rows hard-delete with their parents.

## Integrity and delete behavior

Composite `(project_id, id)` keys prevent a scene from referencing another
project's chapter/location and prevent cross-project tags, participants, and
emotional relations. A guarded trigger additionally requires a project and an
attached global character to have the same owner. Character-link composite FKs
require both endpoints and any scoped project to share `owner_id`.

Project purge cascades project-only descendants but never global characters.
Chapter and location deletion set only the matching scene FK to null. Tag joins
cascade. Character identity and image/context references use RESTRICT to avoid
accidental destructive cascades.

Scene order is one canonical `numeric(20,10)` `position`, sorted by
`(position, id)`. `chapter_id` is grouping only; null means “Без главы”. Future
fractional-position normalization must be one project transaction and increment
revision once.

## JSON and relation semantics

`characters.base_profile` and `project_characters.overrides` are JSON objects.
The database preserves JSON nulls: absent override keys inherit while present
`null` remains an explicit blank for application-approved fields. Effective
profiles are not persisted.

Initial relations and scene changes are directed. `value_operation` is `set`,
`clear`, or null. `set` requires a value, `clear` requires null, and null means
inherit/no value operation. `visible` is independently nullable, so
visibility-only, value-only, and combined changes work; a no-op row is rejected.
Replay is intentionally not implemented in SQL.

Structural links reject self-links and constrain category/structure kind. A null
project is global account canon; a non-null project is a project-context link.
Reversed-semantic duplicate detection remains an application/transaction-layer
task because its canonical fingerprint depends on relationship semantics.

`character_images` stores paths and metadata only: no binary/base64 column and
no Storage bucket. Identity and project-specific primary-image uniqueness is
enforced with partial indexes.

## API grants and RLS

Every new public table has RLS enabled. `anon` has no table privileges.
`authenticated` has only SELECT/INSERT/UPDATE/DELETE; RLS then limits rows.
Direct policies use character owner or project owner. Join/change policies route
through the scene, and scoped/global link policies validate owner, endpoints,
and project. Small `private` security-invoker ownership helpers centralize the
project authorization seam so future membership can extend it. The sole
security-definer function is an uncallable trigger enforcing cross-owner
integrity with an empty search path.

Tests: `supabase/tests/cloud_content_schema.sql` covers schema, constraints,
same-project relations, relation operations, grants and deletes;
`cloud_content_rls.sql` covers two-user CRUD and ID-guessing attacks. Both run in
transactions and roll back fixtures.

## Indexes and known limitations

Indexes cover owner lookup, project/character lookup, canonical chapter/scene
ordering, chapter/location access, join directions, relation endpoints, link
scope/endpoints, image contexts, and every composite FK reported by advisors.

Deferred intentionally: content API/RPCs, revision increments, import/sync,
position normalization, removal preview UX, semantic reversed-link duplicate
detection, collaboration, Storage buckets/uploads, and all frontend integration.
LocalStorage remains the content source of truth in this phase.
