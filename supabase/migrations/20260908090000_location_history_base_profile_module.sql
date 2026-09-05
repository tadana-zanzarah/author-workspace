-- Location History H-base: history ("История") base_profile thematic module.
--
-- CONTEXT: "LOCATION HISTORY -- HYBRID IMPLEMENTATION" (accepted, following the Location History
-- product/architecture audit). History is a HYBRID: this migration ships the PROSE half only --
-- one more base_profile thematic module, exactly the same one-line extension of private.location_
-- thematic_module_keys() that B3B (governmentSociety/economy) and B3C (populationCulture) already
-- proved. The structured half (location_history_events) is a separate migration
-- (20260908100000_location_history_events_foundation.sql) because it introduces real new
-- schema/RLS/RPC surface and deserves its own disposable-CI/pre-flight scrutiny independent of this
-- near-zero-risk allowlist change.
--
-- WHY THIS IS SUFFICIENT: update_location_canonical's base_profile-patch validation/apply loop
-- (20260904130000_location_base_profile_modules.sql), update_project_location_module_selection's
-- shown/hidden validation (20260904140000_location_adaptive_module_selection.sql), and
-- import_local_project_content's per-module sanitization (both migrations) all read private.
-- location_thematic_module_keys() generically -- none of them hardcodes any module name anywhere in
-- a conditional. Extending the allowlist array is therefore the entire backend surface the `history`
-- module's THREE fields (historicalOverview/origin/legends) need; they are opaque JSON to every one
-- of these functions, validated only as "is this key allowlisted" + "is the value a JSON object" --
-- exactly the same treatment every existing module already gets. Field-level shape (which of the
-- three keys are legal, that each is a string) is validated client-side only
-- (js/location-base-profile.js), matching every prior thematic module.
--
-- CANONICAL ORDER: private.normalize_location_module_keys and the live RPC's own no-op comparison
-- both key off this array's ORDER (unnest(allowed) WITH ORDINALITY), not insertion order -- so the
-- new key is appended at the end, preserving the existing five modules' relative order byte-for-
-- byte. Do not reorder the existing five entries.
--
-- NOT INCLUDED: location_history_events (separate migration, see above). Scene/Character/
-- Location relations, event-specific media, and temporal Location snapshots remain explicitly out of
-- scope for this phase (product decision, "IMPORTANT CORRECTIONS FROM THE AUDIT") and are not
-- introduced anywhere in either History migration.
--
-- NO DATA BACKFILL: this migration replaces exactly one function body. It does not ALTER any
-- column, does not UPDATE any existing row, and does not touch RLS policies or grants beyond the
-- allowlist function's own pre-existing grant (re-stated here, identical to before).
create or replace function private.location_thematic_module_keys()
returns text[] language sql immutable security invoker set search_path = ''
as $$ select array['appearanceAtmosphere','geography','governmentSociety','economy','populationCulture','history'] $$;
grant execute on function private.location_thematic_module_keys() to authenticated;
