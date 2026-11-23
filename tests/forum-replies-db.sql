\ir ../supabase/migrations/20261123161727_forum_reply_context.sql
insert into auth.users values ('00000000-0000-4000-8000-000000000006',now());
set local role authenticated;
select pg_temp.as_user(6);
select public.angler_accept('Forum fixture','2026-11-23','2026-11-23');
do $$
declare q uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); leaf uuid:=gen_random_uuid(); deep uuid:=gen_random_uuid();
  other uuid:=gen_random_uuid(); page jsonb; w text:='CZ:401009';
begin
  perform set_config('forum.fixture_root',q::text,true);
  perform set_config('forum.fixture_parent',r::text,true);
  perform public.angler_discussion_post(w,null,q,'Original question',null);
  perform pg_temp.as_user(2);
  perform public.angler_discussion_post(w,q,r,'First answer',null);
  perform pg_temp.as_user(6);
  begin perform public.angler_discussion_withdraw(w,q); raise exception 'Deleted answered question'; exception when sqlstate 'PT409' then null; end;
  perform public.angler_discussion_reply(w,q,r,leaf,'Follow-up',null);
  perform public.angler_discussion_reply(w,q,r,leaf,'Follow-up',null);
  perform public.angler_discussion_post(w,null,other,'Separate topic',null);
  begin perform public.angler_discussion_reply(w,other,r,gen_random_uuid(),'Cross-thread',null); raise exception 'Cross-thread accepted'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_reply('CZ:401001',q,r,gen_random_uuid(),'Cross-water',null); raise exception 'Cross-water accepted'; exception when sqlstate 'PT404' then null; end;
  perform public.angler_discussion_withdraw(w,other);
  perform pg_temp.as_user(2);
  begin perform public.angler_discussion_withdraw(w,r); raise exception 'Deleted answered reply'; exception when sqlstate 'PT409' then null; end;
  perform public.angler_discussion_reply(w,q,leaf,deep,'Third level',null);
  page:=public.angler_water_discussion(w,q);
  perform pg_temp.check_that(page->'items'->0->'replyTo'->>'id'=leaf::text
    and page->'items'->1->'replyTo'->>'excerpt'='First answer'
    and page->'items'->2->>'canWithdraw'='false' and page->'items'->0->>'canWithdraw'='true'
    and jsonb_array_length(page->'items')=3,'Missing reply context or wrong ownership');
  perform public.angler_discussion_withdraw(w,deep);
  perform pg_temp.as_user(6);
  begin perform public.angler_discussion_withdraw(w,leaf); raise exception 'Historical text reply lost'; exception when sqlstate 'PT409' then null; end;
end$$;
reset role;
select angler_discussions.remove_content('CZ:401009',current_setting('forum.fixture_parent')::uuid,null);
set local role authenticated;
select pg_temp.as_user(2);
select pg_temp.check_that(public.angler_water_discussion('CZ:401009',current_setting('forum.fixture_root')::uuid)
  ->'items'->0->'replyTo'->>'excerpt' is null, 'Removed text leaked in quote');
reset role;
-- A second author's surviving reply remains discoverable after the question author erases their account.
set local role authenticated;
select pg_temp.as_user(2);
select public.angler_discussion_post('CZ:401009',current_setting('forum.fixture_root')::uuid,gen_random_uuid(),'Surviving text',null);
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.as_user(2);
select pg_temp.check_that(public.angler_water_discussion('CZ:401009',current_setting('forum.fixture_root')::uuid)->'question'->>'removed'='true'
  and public.angler_water_discussion('CZ:401009',current_setting('forum.fixture_root')::uuid)->'items'->0->>'body'='Surviving text'
  and exists(select from jsonb_array_elements(public.angler_water_discussion('CZ:401009')->'items') i
    where i->>'id'=current_setting('forum.fixture_root') and i->>'author' is null), 'Account erasure lost thread or retained author');
reset role;
