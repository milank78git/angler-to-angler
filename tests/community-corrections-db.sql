\ir ../supabase/migrations/20261126150100_group_catch_moderation.sql
\ir ../supabase/migrations/20261126150200_birth_date_corrections.sql
\ir ../supabase/migrations/20261126150300_remove_stored_age.sql
\ir ../supabase/migrations/20261126181100_preserve_community_parking.sql
select pg_temp.check_that(not has_function_privilege('authenticated','angler_private.correct_birth_date(uuid,date,date)','execute')
  and not has_function_privilege('anon','public.angler_group_catch_remove(uuid,bigint)','execute'),'Correction and moderation grants');
set local role authenticated;
do $$
declare g uuid:=gen_random_uuid(); other_g uuid:=gen_random_uuid(); member_post uuid:=gen_random_uuid(); founder_post uuid:=gen_random_uuid();
  invite uuid; pos bigint; rows jsonb;
begin
  perform pg_temp.as_user(85); perform public.angler_group_create(g,'Catch removal');
  perform public.angler_group_create(other_g,'Separate group');
  invite:=(public.angler_group_invite(g)->>'code')::uuid;
  perform public.angler_group_catch_post(g,founder_post,'2025-10-01','Carp',null,null);
  perform pg_temp.as_user(83); perform public.angler_group_join(invite);
  rows:=public.angler_group_catches(g)->'items'; pos:=(rows->0->>'position')::bigint;
  perform pg_temp.check_that(rows->0->>'canRemove'='false','Member can moderate founder');
  perform public.angler_group_catch_report(g,pos);
  perform public.angler_group_catch_report(g,pos);
  begin perform public.angler_group_catch_remove(g,pos); raise exception 'Removed a peer catch'; exception when sqlstate 'PT404' then null; end;
  perform public.angler_group_catch_post(g,member_post,'2025-10-01','Carp',500,null);
  rows:=public.angler_group_catches(g)->'items'; pos:=(rows->0->>'position')::bigint;
  perform pg_temp.check_that(rows->0->>'canRemove'='true','Missing own withdrawal');
  perform public.angler_group_catch_remove(g,pos);
  perform public.angler_group_catch_remove(g,pos);
  begin perform public.angler_group_catch_post(g,member_post,'2025-10-01','Carp',500,null);
    raise exception 'Retried share resurrected'; exception when sqlstate 'PT409' then null; end;
  perform public.angler_group_catch_post(g,gen_random_uuid(),'2025-10-01','Roach',null,null);
  perform pg_temp.as_user(85); rows:=public.angler_group_catches(g)->'items'; pos:=(rows->0->>'position')::bigint;
  begin perform public.angler_group_catch_remove(other_g,pos); raise exception 'Moderated wrong group';
    exception when sqlstate 'PT404' then null; end;
  perform public.angler_group_catch_remove(g,pos);
  perform public.angler_group_catch_remove(g,(rows->1->>'position')::bigint);
  perform pg_temp.check_that(public.angler_group_catches(g)->'items'='[]'::jsonb,'Founder could not remove both shares');
end $$;
reset role;
do $$
declare person uuid:='00000000-0000-4000-8000-000000000083'; original date; corrected date:=current_date-interval '13 years';
  h text:=encode(sha256('correction fixture'::bytea),'hex'); token uuid:=gen_random_uuid(); solo uuid:=gen_random_uuid();
  peer uuid:='00000000-0000-4000-8000-000000000085'; conversation uuid; pos bigint;
begin
  select born_on into strict original from angler_private.profiles where user_id=person;
  insert into angler_public_cards.cards(author,request,source_id,token,details) values(person,gen_random_uuid(),gen_random_uuid(),token,'{}');
  insert into angler_sync.accounts(owner) values(person) on conflict do nothing;
  insert into angler_sync.chunks(owner,hash,bytes,byte_count) values(person,h,'correction fixture'::bytea,18);
  insert into angler_sync.documents(owner,key,revision,parts) values(person,'trip/correction-fixture',1,array[h]);
  insert into angler_activity.parking_points(id,water,lat,lon,name,creator,editor)
    values(token,'CZ:401009',48.12,14.25,'Personal label',person,person);
  insert into angler_activity.parking_reviews(point,author,stars)
    values(token,'00000000-0000-4000-8000-000000000085',5),(token,person,4);
  insert into angler_activity.parking_points(id,water,lat,lon,name,creator,editor)
    values(solo,'CZ:401009',48.123,14.253,'Private label',person,person);
  insert into angler_messages.threads(first_user,second_user) values(person,peer)
    on conflict(first_user,second_user) do update set first_user=excluded.first_user returning id into conversation;
  insert into angler_messages.entries(thread,from_first,request_id,body)
    values(conversation,true,gen_random_uuid(),'Age correction fixture') returning position into pos;
  update angler_messages.threads set latest=pos where id=conversation;
  perform pg_temp.as_user(85);
  perform pg_temp.check_that(public.angler_message_history(conversation,null,null)->'items'->0->>'body'='Age correction fixture',
    'Peer could not read the original thread');
  perform angler_private.correct_birth_date(person,original,corrected);
  perform pg_temp.check_that(not exists(select from angler_activity.parking_points where id=solo),'Unreviewed point retained');
  perform pg_temp.check_that(not exists(select from jsonb_array_elements(public.angler_message_inbox(null)->'items') item
    where item->>'threadId'=conversation::text),'Inbox exposed a restricted peer');
  begin perform public.angler_message_history(conversation,null,null); raise exception 'Peer could read restricted history';
    exception when sqlstate 'PT404' then null; end;
  perform pg_temp.check_that(exists(select from angler_messages.entries where position=pos),'Private correspondence lost');
  perform pg_temp.check_that(exists(select from angler_activity.parking_points
    where id=token and creator is null and editor is null and name is null)
    and (select count(*)=1 and max(stars)=5 from angler_activity.parking_reviews where point=token),
    'Age correction deleted an independent review or retained identifying details');
  perform pg_temp.check_that(not exists(select from angler_public_cards.cards where author=person)
    and not exists(select from angler_sync.accounts where owner=person)
    and not exists(select from angler_sync.documents where owner=person)
    and not exists(select from angler_sync.chunks where owner=person)
    and not exists(select from angler_sync.usage where owner=person),'Downgrade retained public content or cloud journal');
  perform pg_temp.as_user(83);
  begin perform public.angler_journal_sync('enable','{}'); raise exception 'Child restored cloud access'; exception when insufficient_privilege then null; end;
  begin perform angler_private.correct_birth_date(person,original,original); raise exception 'Stale correction accepted'; exception when sqlstate 'PT409' then null; end;
  perform angler_private.correct_birth_date(person,corrected,original);
  perform pg_temp.check_that((public.angler_my_details()->>'age')::integer=angler_private.age_years(original),'Derived age or licence RPC broken');
end $$;
