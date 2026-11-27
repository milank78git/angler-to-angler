\ir ../supabase/migrations/20261127121000_review_journal_and_community.sql
-- Run the current public contracts only after verifying the historical migrations.
select pg_temp.as_user(85);
do $$
declare gid uuid:=gen_random_uuid(); first_code uuid; next_code uuid; member uuid;
  spot uuid:=gen_random_uuid(); actor uuid:=auth.uid(); epoch jsonb;
begin
  perform public.angler_group_create(gid,'Review fixtures');
  first_code:=(public.angler_group_link(gid)->>'code')::uuid;
  next_code:=(public.angler_group_link(gid)->>'code')::uuid;
  perform pg_temp.as_user(83); member:=auth.uid();
  begin perform public.angler_group_join(first_code); raise exception 'Rotated code accepted'; exception when invalid_parameter_value then null; end;
  perform public.angler_group_join(next_code); perform public.angler_group_join(next_code);
  begin perform public.angler_group_members(gid); raise exception 'Member read roster'; exception when insufficient_privilege then null; end;
  begin perform public.angler_group_revoke(gid); raise exception 'Member revoked link'; exception when insufficient_privilege then null; end;
  begin perform public.angler_group_remove_member(gid,member); raise exception 'Member used owner removal'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(84);
  begin perform public.angler_group_join(next_code); raise exception 'Second use of link'; exception when invalid_parameter_value then null; end;
  perform pg_temp.as_user(85);
  perform pg_temp.check_that(public.angler_group_members(gid)#>>'{items,0,id}'=member::text,'Owner roster');
  perform public.angler_group_remove_member(gid,member);
  perform pg_temp.check_that(public.angler_group_members(gid)->'items'='[]','Member still listed');
  first_code:=(public.angler_group_link(gid)->>'code')::uuid;
  perform public.angler_group_revoke(gid);
  perform pg_temp.as_user(83);
  begin perform public.angler_group_join(first_code); raise exception 'Revoked code accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.angler_group_join(next_code); raise exception 'Removed member rejoined'; exception when invalid_parameter_value then null; end;
  perform pg_temp.as_user(85);
  perform public.angler_parking_save('CZ:401001',spot,0,49.81,14.21,'Review point');
  perform pg_temp.as_user(83); perform public.angler_parking_review(spot,4,'Useful entrance');
  perform pg_temp.as_user(84); perform public.angler_parking_review(spot,5,'Clear');
  perform pg_temp.as_user(85); perform public.angler_parking_remove('CZ:401001',spot,1);
  perform pg_temp.check_that((public.angler_parking_feedback(spot)->>'votes')::int=2,'Independent reviews lost');
  perform pg_temp.check_that((select creator is null from angler_activity.parking_points where id=spot),'Ownership retained');
  epoch:=jsonb_build_object('epoch',public.angler_journal_sync('settings','{}')->'epoch');
  perform public.angler_journal_sync('enable',epoch||'{"consent":true}');
  update angler_sync.accounts set deletion_floor=42 where owner=actor;
  perform public.angler_journal_sync('erase',epoch);
  epoch:=jsonb_build_object('epoch',public.angler_journal_sync('settings','{}')->'epoch');
  perform public.angler_journal_sync('enable',epoch||'{"consent":true}');
  perform pg_temp.check_that((public.angler_journal_sync('list',epoch)->>'floor')::int=0,'Erasure carried deletion floor forward');
  begin update angler_private.profiles set display_name=U&'\0392ob Kemp' where user_id=actor;
    raise exception 'Mixed Greek and Latin accepted'; exception when check_violation then null; end;
  begin perform public.angler_journal_sync('photo_convert',epoch||'{"key":"trip/legacy"}');
    raise exception 'Legacy conversion ran in an interactive request'; exception when sqlstate 'PT503' then null; end;
end $$;

-- Exercise real Storage status decoding and preserve all original bytes when the service is unavailable.
create function extensions.bytea_to_text(b bytea) returns text language sql strict as $$select encode(b,'escape')$$;
create function extensions.text_to_bytea(t text) returns bytea language sql strict as $$select decode(t,'escape')$$;
-- Keep the journal transport fixture for the independent concurrency checks.
alter function extensions.http(extensions.http_request) rename to review_http_base;
create function extensions.http(req extensions.http_request) returns extensions.http_response language plpgsql as $$
begin
  if position('/angler-catch-photos/' in req.uri)>0 then
    return (current_setting('fixture.storage_status')::int,current_setting('fixture.storage_error'));
  end if;
  return extensions.review_http_base(req);
end $$;
do $$
declare actor uuid:=auth.uid(); h text:=repeat('a',64); k text:='trip/missing'; ref jsonb:=jsonb_build_object('id','fish','hash',h);
  epoch jsonb:=jsonb_build_object('epoch',public.angler_journal_sync('settings','{}')->'epoch');
  part text; raw bytea;
begin
  raw:=convert_to(jsonb_build_object('version',2,'value',jsonb_build_object('trip',jsonb_build_object('id','missing'),
    'catches',jsonb_build_array(jsonb_build_object('record',jsonb_build_object('tripId','missing','id','fish','hasPhoto',true),'photoHash',h))))::text,'UTF8');
  part:=encode(sha256(raw),'hex');
  perform public.angler_journal_sync('put',epoch||jsonb_build_object('hash',part,'data',encode(raw,'base64')));
  perform public.angler_journal_sync('save',epoch||jsonb_build_object('format',2,'key',k,'revision',0,'floor',0,
    'parts',jsonb_build_array(part),'unavailable',jsonb_build_array(ref)));
  ref:=ref||epoch||jsonb_build_object('trip',k,'offset',0);
  perform pg_temp.check_that(public.angler_journal_sync('photo_get',ref)->>'expired'='true','Missing file blocked trip');
  update angler_sync.photos set object_id=gen_random_uuid(),size=123,expires=now()+interval '1 day' where owner=actor and trip=k;
  perform set_config('fixture.storage_status','404',true);
  perform set_config('fixture.storage_error','{"code":"NoSuchBucket"}',true);
  begin perform public.angler_journal_sync('photo_get',ref); raise exception 'Lost bucket reported as lost photo'; exception when sqlstate 'PT503' then null; end;
  perform pg_temp.check_that((select object_id is not null from angler_sync.photos where owner=actor and trip=k),'Transient error retired photo');
  perform set_config('fixture.storage_status','400',true);
  perform set_config('fixture.storage_error','{"statusCode":"404","error":"not_found","message":"Object not found"}',true);
  perform pg_temp.check_that(public.angler_journal_sync('photo_get',ref)->>'expired'='true','Missing original blocked sync');
  perform pg_temp.check_that((select object_id is null and attached from angler_sync.photos where owner=actor and trip=k),'Missing object retried indefinitely');
  perform pg_temp.check_that((select cardinality(parts)=1 from angler_sync.documents where owner=actor and key=k),'Missing original removed trip');
end $$;
