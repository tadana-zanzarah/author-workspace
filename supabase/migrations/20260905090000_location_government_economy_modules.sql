-- Location Adaptive Modules B3B: governmentSociety + economy.
--
-- CONTEXT: "Location Adaptive Modules -- B3B Product Specification: Government & Society +
-- Economy" (accepted). Ships exactly the backend surface those two new base_profile thematic
-- modules need -- which, per the shared allowlist's own design (see 20260904130000_location_
-- base_profile_modules.sql), is a ONE-LINE extension of private.location_thematic_module_keys().
-- No table, no column, no index, no new RPC, no backfill.
--
-- WHY THIS IS SUFFICIENT: update_location_canonical's base_profile-patch validation/apply loop
-- (same migration, see the `for patch_key in select jsonb_object_keys(...)` loops), update_
-- project_location_module_selection's shown/hidden validation (20260904140000_location_adaptive_
-- module_selection.sql), and import_local_project_content's per-module sanitization (both
-- migrations) all read private.location_thematic_module_keys() generically -- none of them
-- hardcodes 'appearanceAtmosphere'/'geography' anywhere in a conditional. Extending the allowlist
-- array is therefore the entire backend surface these two new modules need; the module shapes
-- themselves (governmentForm/leadership/politicalSituation/lawsAndRules/securityForces/
-- notableInstitutions for governmentSociety; currency/economicCharacter/industries/costOfLiving/
-- scarcity/tradeConnections for economy) are opaque JSON objects to every one of these functions,
-- validated only as "is this key allowlisted" + "is the value a JSON object" -- exactly the same
-- treatment appearanceAtmosphere/geography already get.
--
-- CANONICAL ORDER: private.normalize_location_module_keys and the live RPC's own no-op comparison
-- both key off this array's ORDER (unnest(allowed) WITH ORDINALITY), not insertion order -- so the
-- two new keys are appended at the end, preserving the existing two modules' relative order
-- byte-for-byte. Do not reorder the existing two entries.
--
-- NOT INCLUDED: populationCulture, historyNotes remain unallowlisted -- this migration ships
-- exactly the two modules that have real frontend/shape behind them as of this task, per the same
-- "no unvalidated write surface" principle the original allowlist comment established.
--
-- NO DATA BACKFILL: this migration replaces exactly one function body. It does not ALTER any
-- column, does not UPDATE any existing row, and does not touch RLS policies or grants beyond the
-- allowlist function's own pre-existing grant (re-stated here, identical to before).
create or replace function private.location_thematic_module_keys()
returns text[] language sql immutable security invoker set search_path = ''
as $$ select array['appearanceAtmosphere','geography','governmentSociety','economy'] $$;
grant execute on function private.location_thematic_module_keys() to authenticated;
