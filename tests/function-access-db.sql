-- Audit effective privileges for every installed project signature, including future overloads.
-- Anonymous access requires both schema USAGE and function EXECUTE, as it does on a real connection.
do $$
declare
  item record;
  permitted boolean;
  expected regprocedure[] := array[
    'public.angler_water_manifest()', 'public.angler_open_catch_card(uuid)',
    'public.angler_report_catch_card(uuid)', 'angler_public_cards.read_link(uuid)',
    'public.angler_community_signal(uuid)', 'public.angler_post_signal(uuid)', 'public.angler_end_post_watch(uuid)'
  ]::regprocedure[];
begin
  for item in
    select p.oid as signature, n.oid as schema_id from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname like 'angler%' or (n.nspname='public' and p.proname like 'angler%')
  loop
    permitted := has_schema_privilege('anon',item.schema_id,'usage') and has_function_privilege('anon',item.signature,'execute');
    if permitted is distinct from (item.signature = any(expected)) then
      raise exception 'Unexpected anonymous access to %: %',item.signature::regprocedure,permitted;
    end if;
  end loop;
  if has_function_privilege('authenticated','public.angler_play_receipt(text,jsonb)','execute')
     or not has_function_privilege('service_role','public.angler_play_receipt(text,jsonb)','execute') then
    raise exception 'Only the settlement service may execute the Play receipt RPC';
  end if;
end $$;
