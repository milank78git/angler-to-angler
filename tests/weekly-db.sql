\ir ../supabase/migrations/20261123163226_group_catch_week.sql
select pg_temp.check_that(not has_table_privilege('authenticated','angler_weekly.entries','select')
  and not has_table_privilege('authenticated','angler_weekly.votes','insert')
  and not has_function_privilege('anon','public.angler_weekly_board(uuid,date,integer,text)','execute')
  and not has_function_privilege('authenticated','angler_weekly.remove_entry(uuid,uuid,uuid)','execute'),'Weekly grants');
select pg_temp.check_that(angler_weekly.monday(date '2027-01-03')=date '2026-12-28'
  and angler_weekly.monday(date '2027-01-04')=date '2027-01-04','Monday across year boundary');
insert into auth.users values ('00000000-0000-4000-8000-000000000007',now()),('00000000-0000-4000-8000-000000000008',now());
set local role authenticated;
select pg_temp.as_user(7); select public.angler_accept('Member','2026-11-23','2026-11-23');
select pg_temp.as_user(8); select public.angler_accept('Visitor','2026-11-23','2026-11-23');
do $$
declare g uuid:=gen_random_uuid(); other_g uuid:=gen_random_uuid(); id uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  peer uuid:=gen_random_uuid(); code uuid; today date:=(now() at time zone 'Europe/Prague')::date; page jsonb; ver text;
  photo text:='UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=';
begin
  perform set_config('test.weekly_group',g::text,true); perform set_config('test.weekly_entry',id::text,true);
  perform set_config('test.weekly_peer',peer::text,true);
  perform pg_temp.as_user(2); perform public.angler_group_create(g,'Weekly group');
  perform public.angler_group_create(other_g,'Separate group'); code:=(public.angler_group_invite(g)->>'code')::uuid;
  perform pg_temp.check_that(public.angler_weekly_board(g)->'items'='[]'::jsonb,'Initial board');
  begin perform public.angler_weekly_enter(g,id,c,today,'Perch',encode(decode(photo,'base64')||'EXIF'::bytea,'base64'));
    raise exception 'Accepted extra bytes'; exception when invalid_parameter_value then null; end;
  begin perform public.angler_weekly_enter(g,id,c,today+1,'Perch',photo);
    raise exception 'Accepted future catch'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_weekly_enter(g,id,c,today-7,'Perch',photo);
    raise exception 'Accepted old catch'; exception when sqlstate 'PT422' then null; end;
  perform public.angler_weekly_enter(g,id,c,today,'Perch',photo);
  perform public.angler_weekly_enter(g,id,c,today,'Perch',photo);
  begin perform public.angler_weekly_enter(g,gen_random_uuid(),c,today,'Perch',photo);
    raise exception 'Duplicate catch'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_weekly_vote(g,id,true); raise exception 'Self vote'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(7);
  begin perform public.angler_weekly_board(g);raise exception 'Outsider read';exception when insufficient_privilege then null;end;
  begin perform public.angler_weekly_vote(g,id,true);raise exception 'Outsider vote';exception when insufficient_privilege then null;end;
  perform public.angler_group_join(code);
  perform public.angler_weekly_enter(g,peer,gen_random_uuid(),today,'Pike',photo);
  perform public.angler_weekly_vote(g,id,true); perform public.angler_weekly_vote(g,id,true);
  perform public.angler_weekly_report(g,id); perform public.angler_weekly_report(g,id);
  page:=public.angler_weekly_board(g);
  perform pg_temp.check_that(page->'items'->0->>'score'='1' and page->'items'->0->>'reported'='true'
    and page->'items'->0->>'photo'=photo and not (page->'items'->0 ? 'catch_id'),'Receipt or projection');
  begin perform public.angler_weekly_withdraw(g,id);raise exception 'Withdrew peer';exception when sqlstate 'PT404' then null;end;
  perform pg_temp.as_user(2);
  begin perform public.angler_weekly_vote(other_g,peer,true);raise exception 'Wrong group';exception when sqlstate 'PT404' then null;end;
  perform public.angler_weekly_vote(g,peer,true);
  for n in 1..2 loop perform public.angler_weekly_enter(g,gen_random_uuid(),gen_random_uuid(),today,'Other fish',photo);end loop;
  page:=public.angler_weekly_board(g);ver:=page->>'version';
  perform pg_temp.check_that(page->'items'->0->>'place'='1' and page->'items'->1->>'place'='1'
    and page->'items'->2->>'place'='3' and page->>'next'='3' and jsonb_array_length(public.angler_weekly_board(g,null,3,ver)->'items')=1,'Ties or rank pagination');
  perform public.angler_weekly_vote(g,peer,false);
  begin perform public.angler_weekly_board(g,null,3,ver);raise exception 'Stale page accepted';exception when sqlstate 'PT409' then null;end;
  perform public.angler_weekly_vote(g,peer,false);
end$$;
reset role;
update angler_weekly.entries set held=true where id=current_setting('test.weekly_entry')::uuid;
set local role authenticated;
select pg_temp.as_user(7);
select pg_temp.check_that(not exists(select from jsonb_array_elements(public.angler_weekly_board(current_setting('test.weekly_group')::uuid)->'items') i
 where i->>'id'=current_setting('test.weekly_entry')), 'Held entry visible to group');
select pg_temp.as_user(2);
select pg_temp.check_that(exists(select from jsonb_array_elements(public.angler_weekly_board(current_setting('test.weekly_group')::uuid,null,3,
 public.angler_weekly_board(current_setting('test.weekly_group')::uuid)->>'version')->'items') i
 where i->>'held'='true' and i->>'place' is null),'Owner cannot manage held entry');
reset role;
update angler_weekly.entries set held=false,caught=caught-7 where id=current_setting('test.weekly_entry')::uuid;
set local role authenticated;
do $$
declare g uuid:=current_setting('test.weekly_group')::uuid; target uuid:=current_setting('test.weekly_entry')::uuid;
 peer uuid:=current_setting('test.weekly_peer')::uuid; archive date; page jsonb;
begin
  perform pg_temp.as_user(7);
  archive:=(public.angler_weekly_board(g)->>'previous')::date;
  page:=public.angler_weekly_board(g,archive);
  perform pg_temp.check_that(page->>'open'='false' and page->'items'->0->>'id'=target::text and page->>'following' is not null,'Archive navigation');
  perform public.angler_weekly_vote(g,target,false);
  begin perform public.angler_weekly_vote(g,target,true);raise exception 'Late vote';exception when sqlstate 'PT422' then null;end;
  perform public.angler_weekly_withdraw(g,peer); perform public.angler_weekly_withdraw(g,peer);
  perform public.angler_group_leave(g);
  begin perform public.angler_weekly_board(g,archive);raise exception 'Former member read';exception when insufficient_privilege then null;end;
  perform pg_temp.as_user(2); perform public.angler_weekly_withdraw(g,target);
  perform pg_temp.check_that(public.angler_weekly_board(g)->>'previous' is null,'Withdrawn archive visible');
  perform public.angler_group_dissolve(g);
end$$;
reset role;
select pg_temp.check_that(not exists(select from angler_weekly.entries) and not exists(select from angler_weekly.votes)
 and not exists(select from angler_weekly.reports),'Orphaned contest data');
