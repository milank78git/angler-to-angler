-- Runs in the same disposable transaction as profile-db.sql.
\ir ../supabase/migrations/20261123105513_private_fishing_groups.sql
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001',now()), ('00000000-0000-4000-8000-000000000002',now()),
 ('00000000-0000-4000-8000-000000000003',now()), ('00000000-0000-4000-8000-000000000004',null);
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-' || lpad(n::text,12,'0'),true)
$$;
create function pg_temp.check_that(ok boolean, detail text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%',detail; end if; end;
$$;
select pg_temp.check_that(not has_table_privilege('authenticated','angler_groups_private.groups','select')
  and not has_table_privilege('authenticated','angler_groups_private.members','insert')
  and not has_function_privilege('anon','public.angler_groups()','execute'),'Unexpected grant');
set local role authenticated;
set local "request.jwt.claims"='{}';
select pg_temp.as_user(1);
do $$begin
 begin perform public.angler_groups(); raise exception 'Missing profile accepted'; exception when insufficient_privilege then null; end;
end$$;
do $$begin for n in 1..4 loop
 perform pg_temp.as_user(n); perform public.angler_accept('Angler ' || n,'2026-11-23','2026-11-23');
end loop; end$$;
do $$begin
 begin perform public.angler_groups(); raise exception 'Unconfirmed email accepted'; exception when insufficient_privilege then null; end;
end$$;
select pg_temp.as_user(1);
set local "request.jwt.claims"='{"is_anonymous":true}';
do $$begin
 begin perform public.angler_groups(); raise exception 'Anonymous JWT accepted'; exception when insufficient_privilege then null; end;
end$$;
set local "request.jwt.claims"='{}';
do $$
declare gid uuid:=gen_random_uuid(); old_code uuid; code uuid; replacement uuid;
begin
 perform public.angler_group_create(gid,'River crew'); perform public.angler_group_create(gid,'River crew');
 perform pg_temp.check_that(jsonb_array_length(public.angler_groups()->'groups')=1
   and (public.angler_groups()->'groups'->0->>'owner')::boolean,'Create/retry did not produce one owned group');
 old_code := (public.angler_group_invite(gid)->>'code')::uuid;
 code := (public.angler_group_invite(gid)->>'code')::uuid;
 perform pg_temp.as_user(2);
 perform pg_temp.check_that(public.angler_groups()->'groups'='[]'::jsonb,'Group visible before join');
 begin perform public.angler_group_invite(gid); raise exception 'Outsider invited'; exception when insufficient_privilege then null; end;
 begin perform public.angler_group_join(old_code); raise exception 'Rotated token accepted'; exception when invalid_parameter_value then null; end;
 perform public.angler_group_join(code); perform public.angler_group_join(code);
 perform pg_temp.check_that(public.angler_groups()->'groups'->0->>'id'=gid::text
   and not (public.angler_groups()->'groups'->0->>'owner')::boolean
   and public.angler_groups()->'groups'->0->>'memberCount'='2','Incorrect joined group');
 begin perform public.angler_group_invite(gid); raise exception 'Member issued invite'; exception when insufficient_privilege then null; end;
 perform public.angler_group_dissolve(gid);
 perform pg_temp.check_that(jsonb_array_length(public.angler_groups()->'groups')=1,'Member dissolved group');
 perform pg_temp.as_user(3);
 begin perform public.angler_group_join(code); raise exception 'Invitation reused'; exception when invalid_parameter_value then null; end;
 perform pg_temp.check_that(public.angler_groups()->'groups'='[]'::jsonb,'Non-member read group');
 perform pg_temp.as_user(2); perform public.angler_group_leave(gid); perform public.angler_group_leave(gid);
 perform pg_temp.check_that(public.angler_groups()->'groups'='[]'::jsonb,'Membership survived leave');
 begin perform public.angler_group_join(code); raise exception 'Left member reused old invite'; exception when invalid_parameter_value then null; end;
 perform pg_temp.as_user(1);
 perform pg_temp.check_that(public.angler_groups()->'groups'->0->>'memberCount'='1','Owner still counts former member');
 replacement := (public.angler_group_invite(gid)->>'code')::uuid;
 perform pg_temp.as_user(3); perform public.angler_group_join(replacement);
 perform pg_temp.as_user(1); perform public.angler_group_dissolve(gid);
 perform pg_temp.as_user(3); perform pg_temp.check_that(public.angler_groups()->'groups'='[]'::jsonb,'Dissolved group still visible');
end$$;
select pg_temp.as_user(1);
select public.angler_group_create('10000000-0000-4000-8000-000000000001','Expiry');
select public.angler_group_invite('10000000-0000-4000-8000-000000000001')->>'code' as expired \gset
reset role;
update angler_groups_private.groups set invite_expires_at=now()-interval '1 second';
set local role authenticated;
select pg_temp.as_user(3);
select set_config('test.expired', :'expired', true);
do $$begin
 begin perform public.angler_group_join(current_setting('test.expired')::uuid); raise exception 'Expired invitation accepted'; exception when invalid_parameter_value then null; end;
end$$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000001';
select pg_temp.check_that(not exists(select from angler_groups_private.groups),'Owner deletion left group data');
