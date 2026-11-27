\ir ../supabase/migrations/20261127100000_private_photo_retention.sql
-- Only the byte transport is substituted. Exercise the public RPC, real manifests,
-- row locks, account gates, expiry, quota and maintenance in the PostgreSQL fixture.
create table pg_temp.photo_files(id uuid primary key, data bytea);
create or replace function angler_sync.photo_storage(verb text,object_key uuid,body bytea default null,start_byte integer default null)
returns bytea language plpgsql set search_path='' as $$
declare data bytea;
begin
  if verb='POST' then insert into pg_temp.photo_files values(object_key,body); return null; end if;
  if verb='GET' then select f.data into strict data from pg_temp.photo_files f where id=object_key;
    if start_byte is not null then return substring(data from start_byte+1 for 65536); end if;
    return data;
  end if;
  delete from pg_temp.photo_files where id=object_key; return null;
end $$;
update angler_sync.photo_rollout set started_at=now();
select pg_temp.as_user(85);
do $$
declare actor uuid:=auth.uid(); k text:='trip/retention'; jpeg bytea:=decode('ffd8ff001234ffd9','hex');
  h text:=encode(sha256(jpeg),'hex'); chunk text; ref jsonb; epoch jsonb; doc jsonb; payload bytea;
  result jsonb; expiry timestamptz; prior text; current_cycle text; version bigint;
begin
  epoch:=jsonb_build_object('epoch',public.angler_journal_sync('settings','{}')->'epoch');
  perform public.angler_journal_sync('enable',epoch||'{"consent":true}');
  ref:=jsonb_build_object('trip',k,'id','fish','hash',h)||epoch;
  doc:=jsonb_build_object('version',1,'value',jsonb_build_object('trip',jsonb_build_object('id','retention','notes','keep me'),
    'catches',jsonb_build_array(jsonb_build_object('record',jsonb_build_object('id','fish','tripId','retention','hasPhoto',true),
    'photo',jsonb_build_object('type','image/jpeg','data',encode(jpeg,'base64'))))));
  payload:=convert_to(doc::text,'UTF8'); chunk:=encode(sha256(payload),'hex');
  perform public.angler_journal_sync('put',epoch||jsonb_build_object('hash',chunk,'data',encode(payload,'base64')));
  perform public.angler_journal_sync('save',epoch||jsonb_build_object('key',k,'revision',0,
    'floor',coalesce((select deletion_floor from angler_sync.accounts where owner=actor),0),'parts',jsonb_build_array(chunk)));
  perform angler_sync.maintain_photos();
  select expires,cycle into strict expiry,prior from angler_sync.photos where owner=actor and trip=k;
  perform pg_temp.check_that(expiry=now()+interval '12 months','Historical photo did not receive a full year');
  select revision into version from angler_sync.documents where owner=actor and key=k;
  perform pg_temp.check_that((angler_sync.document_json(actor,(select parts from angler_sync.documents where owner=actor and key=k))#>>'{value,trip,notes}')='keep me','Metadata lost');
  perform pg_temp.check_that(decode(public.angler_journal_sync('photo_get',ref||'{"offset":0}')->>'data','base64')=jpeg,'Binary mismatch');
  perform pg_temp.check_that((select expires=expiry from angler_sync.photos where owner=actor and trip=k),'Background GET renewed the lease');
  begin perform public.angler_journal_sync('save',epoch||jsonb_build_object('key',k,'revision',version,'parts','[]'::jsonb));
    raise exception 'Legacy phone replaced a converted trip'; exception when sqlstate 'PT426' then null; end;
  perform pg_temp.check_that(jsonb_array_length(public.angler_journal_sync('photo_list',epoch)->'photos')>=1,'Photo list empty');
  update angler_sync.photos set expires=now()+interval '5 days' where owner=actor and trip=k;
  perform public.angler_journal_sync('photo_renew',ref||jsonb_build_object('cycle',prior));
  perform pg_temp.check_that((select expires>now()+interval '11 months' from angler_sync.photos where owner=actor and trip=k),'Renew failed');
  update angler_sync.photos set expires=now()-interval '1 second' where owner=actor and trip=k;
  perform pg_temp.check_that(public.angler_journal_sync('photo_renew',ref||jsonb_build_object('cycle',prior))->>'expired'='true','Renewed an expired photo');
  perform angler_sync.maintain_photos();
  perform pg_temp.check_that((select object_id is null from angler_sync.photos where owner=actor and trip=k),'Expired binary reachable');
  perform pg_temp.check_that((public.angler_journal_sync('photo_need',ref)->>'needed')::boolean=false,'Automatic re-upload requested');
  perform pg_temp.check_that(public.angler_journal_sync('photo_get',ref||'{"offset":0}')->>'expired'='true','Expired read');
  perform public.angler_journal_sync('photo_part',ref||jsonb_build_object('part',0,'data',encode(jpeg,'base64')));
  perform public.angler_journal_sync('photo_reupload',ref||jsonb_build_object('cycle',prior));
  select cycle into current_cycle from angler_sync.photos where owner=actor and trip=k;
  perform pg_temp.check_that(current_cycle<>prior,'Re-upload reused the generation');
  perform pg_temp.check_that(public.angler_journal_sync('photo_renew',ref||jsonb_build_object('cycle',prior))->>'expired'='true','Stale renewal applied');
  perform pg_temp.as_user(82);
  begin perform public.angler_journal_sync('photo_list','{}'); raise exception 'Child listed copies'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(85);
  perform public.angler_journal_sync('erase',epoch);
  perform pg_temp.check_that(not exists(select from angler_sync.photos where owner=actor),'Erasure retained photos');
end $$;
