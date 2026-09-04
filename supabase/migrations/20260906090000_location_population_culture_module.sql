-- Location Adaptive Modules B3C: populationCulture ("Население и культура").
--
-- CONTEXT: "Location Adaptive Modules -- B3C Product Specification: Population & Culture"
-- (accepted). Ships exactly the backend surface this one new base_profile thematic module needs --
-- which, exactly as B3B (governmentSociety/economy, see 20260905090000_location_government_
-- economy_modules.sql) established, is a ONE-LINE extension of private.location_thematic_module_
-- keys(). No table, no column, no index, no new RPC, no backfill.
--
-- WHY THIS IS SUFFICIENT: update_location_canonical's base_profile-patch validation/apply loop
-- (20260904130000_location_base_profile_modules.sql), update_project_location_module_selection's
-- shown/hidden validation (20260904140000_location_adaptive_module_selection.sql), and
-- import_local_project_content's per-module sanitization (both migrations) all read private.
-- location_thematic_module_keys() generically -- none of them hardcodes any module name anywhere in
-- a conditional. Extending the allowlist array is therefore the entire backend surface
-- populationCulture needs; its seven fields (populationCharacter/peoplesAndGroups/languages/
-- customsAndTraditions/holidays/beliefs/socialNorms) are opaque JSON to every one of these
-- functions, validated only as "is this key allowlisted" + "is the value a JSON object" -- exactly
-- the same treatment every existing module already gets.
--
-- CANONICAL ORDER: private.normalize_location_module_keys and the live RPC's own no-op comparison
-- both key off this array's ORDER (unnest(allowed) WITH ORDINALITY), not insertion order -- so the
-- new key is appended at the end, preserving the existing four modules' relative order
-- byte-for-byte. Do not reorder the existing four entries.
--
-- NOT INCLUDED: historyNotes, media, and location<->location / character<->location relations
-- remain out of scope for this phase (see task brief) and unallowlisted -- this migration ships
-- exactly the one module this phase's frontend/shape actually supports, per the same "no
-- unvalidated write surface" principle the original allowlist comment established.
--
-- NO DATA BACKFILL: this migration replaces exactly one function body. It does not ALTER any
-- column, does not UPDATE any existing row, and does not touch RLS policies or grants beyond the
-- allowlist function's own pre-existing grant (re-stated here, identical to before).
create or replace function private.location_thematic_module_keys()
returns text[] language sql immutable security invoker set search_path = ''
as $$ select array['appearanceAtmosphere','geography','governmentSociety','economy','populationCulture'] $$;
grant execute on function private.location_thematic_module_keys() to authenticated;
