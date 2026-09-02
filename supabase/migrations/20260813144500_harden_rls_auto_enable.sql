-- Supabase's RLS auto-enable event trigger must not be a client-callable RPC.
--
-- public.rls_auto_enable() is provisioned by the hosted Supabase platform itself (outside
-- this migration history), not by `supabase start`'s local dev stack -- so a fresh local/CI
-- Postgres built from this migration chain never has it. Guarded so this migration replays
-- cleanly there while still revoking exactly as before wherever the function does exist
-- (production and any other hosted project).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
