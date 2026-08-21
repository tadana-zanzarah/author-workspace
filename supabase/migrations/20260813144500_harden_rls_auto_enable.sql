-- Supabase's RLS auto-enable event trigger must not be a client-callable RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
