\ir ../supabase/migrations/20261124101500_post_notifications.sql

-- The notification capability exposes only a cursor and water, never the discussion itself.
set local role authenticated;
select pg_temp.as_user(71);
select public.angler_register_post_watch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.angler_discussion_post('CZ:401009',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Field notice fixture',null);
select pg_temp.as_user(72);
select public.angler_register_post_watch('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
set local role anon;
do $$
declare latest jsonb:=public.angler_post_signal('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
begin
  if latest->>'water' is distinct from 'CZ:401009' or (select count(*) from jsonb_object_keys(latest))<>2 then
    raise exception 'Invalid post signal'; end if;
  if (public.angler_post_signal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'position')::bigint >= (latest->>'position')::bigint then
    raise exception 'Own post triggered a notification'; end if;
  begin perform public.angler_post_signal(gen_random_uuid()); raise exception 'Invalid key accepted';
    exception when sqlstate 'PT403' then null; end;
  if has_function_privilege('anon','public.angler_register_post_watch(uuid)','execute') then
    raise exception 'Anonymous registration allowed'; end if;
  perform public.angler_end_post_watch('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  begin perform public.angler_post_signal('cccccccc-cccc-4ccc-8ccc-cccccccccccc'); raise exception 'Revoked key accepted';
    exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
