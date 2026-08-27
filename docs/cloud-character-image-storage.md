# Cloud character image storage

Character originals live in the private Supabase Storage bucket `character-images`. Postgres stores metadata only in `character_images`; binary, base64 and signed URLs are forbidden as canonical database values.

## Object and scope contract

The immutable object path is `<owner_uuid>/characters/<character_uuid>/<photo_uuid>/original.<ext>`. The extension is derived from the validated MIME allowlist (`jpeg`, `png`, `webp`, `gif`); the source filename is never identity. Storage RLS checks the authenticated `auth.uid()` against the first path component for SELECT, INSERT, UPDATE and DELETE. The bucket is private, limited to 3 MiB, and signed URLs live for 15 minutes in runtime memory only.

`project_character_id IS NULL` is an identity-level image. A non-null value is a project-specific image; the existing composite foreign key guarantees that its project character depicts the same global identity. Partial unique indexes enforce at most one active primary per identity scope and per project-character scope. Crop, alt, caption, order, primary state, safe unknown metadata, `storage_path`, MIME type and revisions remain in Postgres. Crop changes never upload or replace the original.

## Writes and compensation

Upload validates MIME, size and browser decoding, creates a UUID photo ID/path, uploads with `upsert:false`, then calls `create_character_image`. A failed metadata RPC triggers deletion of exactly the newly uploaded path. If cleanup also fails, the operation reports an orphan/recovery state and never reports success. An upload failure never creates metadata.

Delete first soft-deletes metadata, selects a deterministic fallback primary and marks `storage_cleanup_required`; only then does the client remove the object. Storage failure therefore preserves a recoverable database record instead of causing silent irreversible metadata loss. Test cleanup may hard-delete the already soft-deleted fixture row only after its object is gone.

Global add/delete uses the global character revision; global metadata updates use the image-row revision. Project-specific mutations use the locked project revision and bump it exactly once. Stale mutations return `CHARACTER_REVISION_CONFLICT`, `CHARACTER_IMAGE_REVISION_CONFLICT`, or `REVISION_CONFLICT` and are never retried blindly.

## Reads and legacy boundary

Cloud hydration loads identity images plus the current project-character override images, creates short-lived signed URLs and keeps `storage_path` canonical. If URL refresh fails, metadata remains and the UI can show an unavailable state. A local data-URL photo is retained when the cloud character has no cloud image, marked as a pending legacy condition, and is never automatically uploaded. `?local=1` continues to use the original data-URL/crop/lightbox path.
