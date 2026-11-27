\ir ../supabase/migrations/20261127032314_journal_community_controls.sql

-- Exercise the public RPCs with independent accounts and real permissions.
set local role authenticated;
do $$
declare owner_key uuid:=gen_random_uuid(); group_key uuid:=gen_random_uuid(); link1 uuid; link2 uuid;
  tip_id uuid:=gen_random_uuid(); pos bigint; stamp bigint; account_epoch text;
  topic uuid:=gen_random_uuid(); reply uuid:=gen_random_uuid(); thread_id uuid; point_id uuid:=gen_random_uuid();
  week_entry uuid:=gen_random_uuid(); water text:='CZ:401009'; inbox jsonb; snapshot jsonb;
  photo text:='UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=';
begin
  perform pg_temp.as_user(85);
  perform public.angler_group_create(group_key,'New invitations');
  link1:=(public.angler_group_link(group_key)->>'code')::uuid;
  link2:=(public.angler_group_link(group_key)->>'code')::uuid;
  perform public.angler_watch_community(owner_key);
  perform public.angler_discussion_post(water,null,topic,'Audit question',null);
  perform pg_temp.as_user(83); perform public.angler_group_join(link1);
  perform public.angler_group_tip_post(group_key,tip_id,'First tip');
  pos:=(public.angler_group_tips(group_key)->'tips'->0->>'position')::bigint;
  perform public.angler_group_tip_change(group_key,pos,'edit','Updated tip','First tip');
  perform pg_temp.as_user(84); perform public.angler_group_join(link1); perform public.angler_group_join(link2);
  perform public.angler_group_tip_change(group_key,pos,'report');
  begin perform public.angler_group_tip_change(group_key,pos,'remove'); raise exception 'Peer removed tip';
    exception when sqlstate 'PT404' then null; end;
  perform public.angler_weekly_enter(group_key,week_entry,gen_random_uuid(),(now() at time zone 'Europe/Prague')::date,'Carp',photo);
  perform public.angler_discussion_post(water,topic,reply,'Audit answer',null);
  thread_id:=(public.angler_message_send(null,topic,gen_random_uuid(),'Private reply')->>'threadId')::uuid;
  perform pg_temp.as_user(85);
  snapshot:=public.angler_community_signal(owner_key);
  perform pg_temp.check_that((snapshot->>'tips')::bigint=pos and (snapshot->>'weekly')::bigint>0
    and (snapshot->>'messages')::bigint>0 and (snapshot->>'replies')::bigint>0,'Missing activity');
  perform public.angler_weekly_withdraw(group_key,week_entry);
  perform public.angler_group_tip_change(group_key,pos,'remove');
  perform pg_temp.check_that(public.angler_group_tips(group_key)->'tips'='[]'::jsonb,'Removed tip visible');
  perform pg_temp.check_that((public.angler_water_discussion(water,topic)->'question'->>'canWithdraw')='false','Live reply lost');
  perform pg_temp.check_that(public.angler_latest_reply()->>'question'=topic::text,'Wrong reply destination');
  inbox:=public.angler_message_inbox()->'items'->0;
  perform pg_temp.check_that(inbox->>'threadId'=thread_id::text and inbox->>'unread'='true','Missing unread receipt');
  stamp:=(public.angler_message_history(thread_id,null)->'items'->0->>'id')::bigint;
  perform public.angler_message_read(thread_id,stamp);
  perform pg_temp.check_that(public.angler_message_inbox()->'items'->0->>'unread'='false','Unread after opening');
  perform pg_temp.as_user(84); perform public.angler_discussion_withdraw(water,reply);
  perform public.angler_parking_save(water,point_id,0,49.121,14.121,'Owned point');
  perform pg_temp.as_user(85);
  begin perform public.angler_parking_remove(water,point_id,1); raise exception 'Deleted peer point'; exception when sqlstate 'PT404' then null; end;
  perform public.angler_discussion_withdraw(water,topic);
  perform pg_temp.as_user(84);
  perform public.angler_parking_remove(water,point_id,1);
  perform public.angler_journal_sync('enable','{}');
  perform public.angler_journal_sync('erase','{}');
  begin perform public.angler_journal_sync('enable','{}'); raise exception 'Old device enabled erased backup'; exception when sqlstate 'PT410' then null; end;
  snapshot:=public.angler_journal_sync('settings','{}');
  account_epoch:=snapshot->>'epoch';
  perform pg_temp.check_that(snapshot->>'enabled'='false' and account_epoch is not null,'Missing erasure boundary');
  perform public.angler_journal_sync('enable',jsonb_build_object('epoch',account_epoch,'consent',true));
  begin perform public.angler_journal_sync('list','{}'); raise exception 'Old device received empty manifest'; exception when sqlstate 'PT410' then null; end;
  perform pg_temp.as_user(82);
  begin perform public.angler_message_inbox(); raise exception 'Child inbox'; exception when insufficient_privilege then null; end;
  perform public.angler_end_post_watch(owner_key);
  begin perform public.angler_community_signal(owner_key); raise exception 'Revoked signal'; exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
