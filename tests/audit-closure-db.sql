\ir ../supabase/migrations/20261126060000_community_protection.sql
\ir ../supabase/migrations/20261126060100_favourite_post_watches.sql
\ir ../supabase/migrations/20261126060200_account_revision.sql

-- The fixture only replaces the external Storage transport. Production functions run as installed.
create schema storage;
create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text,name text primary key,created_at timestamptz default now(),content text);
create schema vault;
create table vault.decrypted_secrets(name text,decrypted_secret text);
insert into vault.decrypted_secrets values ('angler_storage_url','http://fixture/storage/v1'),('angler_storage_key','test');
create type extensions.http_header as (field varchar,value varchar);
create type extensions.http_request as (method varchar,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
create function extensions.http_header(varchar,varchar) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
create function extensions.http(req extensions.http_request) returns extensions.http_response language plpgsql as $$
declare path text:=split_part(req.uri,'/angler-journal/',2); result text;
begin
  if req.method='POST' then insert into storage.objects(bucket_id,name,content) values('angler-journal',path,req.content);
  elsif req.method='GET' then select content into strict result from storage.objects where name=path;
  elsif req.method='DELETE' then delete from storage.objects where name=path;
  else raise exception 'Unknown fixture method'; end if;
  return (200,result);
end $$;
\ir ../supabase/migrations/20261126060300_journal_object_storage.sql

set local role authenticated;
select pg_temp.as_user(970);
do $$begin
 begin perform public.angler_accept(U&'Unique\2060nickname','2026-11-26','2026-11-26');
 raise exception 'Invisible controls accepted in a new name'; exception when sqlstate 'AN001' then null; end;
end$$;
select pg_temp.as_user(71);
select pg_temp.check_that((public.angler_profile()->>'current')::boolean=false,'Old terms accepted as current');
do $$begin
 begin perform public.angler_accept('Existing','2026-11-23','2026-11-23');
 raise exception 'Stale terms accepted'; exception when invalid_parameter_value then null; end;
 perform public.angler_accept('Existing','2026-11-26','2026-11-26');
 perform pg_temp.check_that((public.angler_profile()->>'current')::boolean,'Reacceptance failed');
end$$;
select pg_temp.as_user(72);
select public.angler_accept('Existing','2026-11-26','2026-11-26');
do $$declare device uuid:=gen_random_uuid(); signal jsonb; begin
 perform public.angler_watch_favourites(device,array['CZ:401009']);
 perform pg_temp.as_user(71);
 perform public.angler_discussion_post('CZ:401009',null,gen_random_uuid(),'Watched water',null);
 perform public.angler_discussion_post('CZ:401001',null,gen_random_uuid(),'Unrelated newer post',null);
 signal:=public.angler_post_signal(device);
 perform pg_temp.check_that(signal->>'water'='CZ:401009','Unrelated post leaked');
 perform pg_temp.as_user(72);
 perform public.angler_watch_favourites(device,array[]::text[]);
 perform pg_temp.check_that(public.angler_post_signal(device)='{"position":"0"}','Removed favourite still alerts');
end$$;
select pg_temp.as_user(71);
do $$declare submission uuid; begin
 for n in 1..6 loop perform public.angler_group_create(gen_random_uuid(),'Group '||n); end loop;
 begin perform public.angler_group_create(gen_random_uuid(),'Over quota'); raise exception 'Seventh group allowed';
 exception when sqlstate 'PT429' then null; end;
end$$;
do $$declare owner_id uuid:=(public.angler_profile()->>'id')::uuid; rev integer; point_id uuid:=gen_random_uuid();
begin
 rev:=coalesce((public.angler_card(null)->>'revision')::integer,0);
 perform public.angler_save_card(rev,'','','',1,null,true);
 perform public.angler_parking_save('CZ:401009',point_id,0,49.880101,14.412121,'First position');
 perform public.angler_parking_save('CZ:401009',point_id,1,49.880201,14.412221,'Moved position');
 perform public.angler_parking_review(point_id,3,'Narrow approach');
 perform pg_temp.as_user(72);
 perform public.angler_report_parking_note(((public.angler_parking_feedback(point_id)->'noteItems'->0)->>'id')::bigint,'Narrow approach');
 perform public.angler_report_content('profile',owner_id);
 perform public.angler_report_content('parking',point_id);
 perform pg_temp.as_user(71);
 perform public.angler_save_card(rev+1,'','','',1,null,false);
 perform pg_temp.as_user(72);
 begin perform public.angler_report_content('profile',owner_id); raise exception 'Private profile reported';
 exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
do $$declare p uuid; begin
 select parking into strict p from angler_private.content_reports where parking is not null;
 perform angler_activity.restore_parking(p,2,1);
 perform pg_temp.check_that((select revision=3 and name='First position' from angler_activity.parking_points where id=p),'Restore lost original location');
 begin perform angler_activity.restore_parking(p,2,1); raise exception 'Stale moderator overwrote a newer location';
 exception when sqlstate 'PT409' then null; end;
end $$;

insert into angler_public_cards.cards(author,request,source_id,token,details) values
 ('00000000-0000-4000-8000-000000000071',gen_random_uuid(),gen_random_uuid(),'ab000000-0000-4000-8000-000000000071','{}');
set local role anon;
select public.angler_report_catch_card('ab000000-0000-4000-8000-000000000071');
select public.angler_report_catch_card('ab000000-0000-4000-8000-000000000071');
select public.angler_report_catch_card(gen_random_uuid());
reset role;
select pg_temp.check_that((select count(*)=1 from angler_private.content_reports where catch_card is not null),'Anonymous queue unbounded');

set local role authenticated;
select pg_temp.as_user(71);
do $$declare h text:=encode(sha256('object bytes'::bytea),'hex'); payload jsonb; begin
 perform public.angler_journal_sync('enable','{}');
 perform public.angler_journal_sync('put',jsonb_build_object('hash',h,'data',encode('object bytes'::bytea,'base64')));
 perform pg_temp.check_that(public.angler_journal_sync('get',jsonb_build_object('hash',h))->>'data'=encode('object bytes'::bytea,'base64'),'Corrupt object');
 payload:=jsonb_build_object('key','trip/object-test','revision',0,'parts',jsonb_build_array(h));
 perform public.angler_journal_sync('save',payload);
 perform pg_temp.as_user(72);
 begin perform public.angler_journal_sync('get',jsonb_build_object('hash',h)); raise exception 'Cross-account read';
 exception when no_data_found then null; end;
 perform pg_temp.as_user(71);
 perform public.angler_journal_sync('save',payload||'{"parts":[],"revision":1}');
end $$;
reset role;
update angler_sync.documents set changed_at=now()-interval '91 days' where key='trip/object-test';
update storage.objects set created_at=now()-interval '2 days';
insert into angler_sync.chunks(owner,hash,bytes,byte_count)
  values ('00000000-0000-4000-8000-000000000071',encode(sha256('legacy photo'::bytea),'hex'),'legacy photo'::bytea,12);
select angler_sync.maintain();
select pg_temp.check_that((select bytes is null and object_id is not null from angler_sync.chunks
  where hash=encode(sha256('legacy photo'::bytea),'hex')),'Historical bytes were not migrated');
select pg_temp.check_that(angler_sync.read_chunk('00000000-0000-4000-8000-000000000071',encode(sha256('legacy photo'::bytea),'hex'))->>'data'
  =encode('legacy photo'::bytea,'base64'),'Historical bytes corrupted');
do $$begin
 begin perform angler_sync.save_document('00000000-0000-4000-8000-000000000071','{"key":"trip/object-test","parts":[],"revision":0}');
 raise exception 'Stale device recreated a collected document'; exception when sqlstate 'PT409' then null; end;
end$$;
select pg_temp.check_that(not exists (select from angler_sync.documents where key='trip/object-test'),'Old tombstone retained');
select pg_temp.check_that(not exists (select from storage.objects o where not exists(select from angler_sync.chunks c where c.object_id::text=o.name)),'Unreferenced object retained');
