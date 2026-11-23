-- Uses the four synthetic identities and disposable transaction established by profile-db.sql.
\ir ../supabase/migrations/20261123142819_private_group_tips.sql
select pg_temp.check_that(not has_function_privilege('anon','public.angler_group_tip_post(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.angler_group_tips(uuid,bigint)','execute')
  and not has_function_privilege('authenticated','angler_groups_private.require_group_access(uuid,uuid)','execute')
  and not has_table_privilege('authenticated','angler_groups_private.tips','select')
  and not has_table_privilege('authenticated','angler_groups_private.tips','insert'), 'Unexpected tip privilege');

set local role authenticated;
do $$
declare gid uuid:=gen_random_uuid(); other_group uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
  code uuid; msg text:=E'Fish the shade <slowly> & pause.\nRevír · Sázava';
  result jsonb; cursor bigint;
begin
  perform pg_temp.as_user(2);
  perform public.angler_group_create(gid,'Test river');
  perform public.angler_group_create(other_group,'Private lake');
  perform pg_temp.check_that(public.angler_group_tips(gid)->'tips'='[]'::jsonb,'Expected empty feed');
  code:=(public.angler_group_invite(gid)->>'code')::uuid;
  perform pg_temp.as_user(3);
  begin perform public.angler_group_tips(gid); raise exception 'Outsider read tips'; exception when insufficient_privilege then null; end;
  begin perform public.angler_group_tip_post(gid,req,msg); raise exception 'Outsider posted'; exception when insufficient_privilege then null; end;
  perform public.angler_group_join(code);
  begin perform public.angler_group_tip_post(gid,req,E'  \t\n'); raise exception 'Blank tip accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.angler_group_tip_post(gid,req,repeat('x',4097)); raise exception 'Oversize tip accepted'; exception when invalid_parameter_value then null; end;
  perform public.angler_group_tip_post(gid,req,msg);
  perform pg_temp.check_that(public.angler_group_tip_post(gid,req,msg)->>'id'=req::text,'Retry receipt mismatch');
  begin perform public.angler_group_tip_post(gid,req,'Changed'); raise exception 'Different retry accepted'; exception when sqlstate 'PT409' then null; end;
  perform pg_temp.as_user(2);
  result:=public.angler_group_tips(gid);
  perform pg_temp.check_that(jsonb_array_length(result->'tips')=1 and result->'tips'->0->>'text'=msg
    and result->'tips'->0->>'author'='Angler 3' and result->>'next' is null,'Shared preview or author mismatch');
  perform pg_temp.check_that(public.angler_group_tips(other_group)->'tips'='[]'::jsonb,'Cross-group leak');
  for i in 1..20 loop perform public.angler_group_tip_post(gid,gen_random_uuid(),'Owner tip ' || i); end loop;
  result:=public.angler_group_tips(gid);
  perform pg_temp.check_that(jsonb_array_length(result->'tips')=20 and result->'tips'->0->>'text'='Owner tip 20','Page size/order mismatch');
  cursor:=(result->>'next')::bigint;
  perform public.angler_group_tip_post(gid,gen_random_uuid(),'New arrival');
  result:=public.angler_group_tips(gid,cursor);
  perform pg_temp.check_that(jsonb_array_length(result->'tips')=1 and result->'tips'->0->>'text'=msg and result->>'next' is null,'Cursor gap or duplicate');
  perform pg_temp.as_user(3);
  perform public.angler_group_leave(gid);
  begin perform public.angler_group_tips(gid,cursor); raise exception 'Former member read history'; exception when insufficient_privilege then null; end;
  begin perform public.angler_group_tip_post(gid,req,msg); raise exception 'Former member retried'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(2);
  perform pg_temp.check_that(public.angler_group_tips(gid,cursor)->'tips'='[]'::jsonb,'Former member post survived');
  perform public.angler_group_dissolve(gid);
  begin perform public.angler_group_tips(gid); raise exception 'Dissolved feed visible'; exception when insufficient_privilege then null; end;
end$$;
reset role;
select pg_temp.check_that(not exists(select from angler_groups_private.tips),'Dissolving left orphan tips');
