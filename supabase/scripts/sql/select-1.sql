-- Minimal harmless diagnostic for proving the production read-only runner works.
-- Safe to run against production any time: read-only, no table access.
select 1 as ok, current_database() as database, current_user as db_user;
