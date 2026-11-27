-- An erased account has no prior journal history in its new epoch.
update angler_sync.accounts set deletion_floor=0 where erased and deletion_floor<>0;
-- A masked or temporarily missing Storage object retains its identity and lease.
alter table angler_sync.photos add column retry_read_at timestamptz;
create index journal_missing_original_retry on angler_sync.photos(retry_read_at) where retry_read_at is not null;
drop trigger photo_quota on angler_sync.photos;
create trigger photo_quota after insert or update of object_id,expires,attached,retry_read_at or delete on angler_sync.photos
  for each row execute function angler_sync.photo_quota();

alter table angler_sync.photos drop constraint photos_size_check,
  add constraint photos_size_check check(size between 1 and 16777216 or (size=0 and object_id is null));

create or replace function angler_sync.journal(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); result jsonb; account angler_sync.accounts; rollout timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,13));
  select started_at into rollout from angler_sync.photo_rollout;
  if op='erase' then
    result:=angler_sync.journal_v1(op,args);
    delete from angler_sync.photos where owner=actor;
    delete from angler_sync.photo_parts where owner=actor;
    update angler_sync.accounts set deletion_floor=0 where owner=actor;
    return result;
  end if;
  if rollout is null then return angler_sync.journal_v1(op,args); end if;
  if op like 'photo\_%' escape '\' then
    select * into account from angler_sync.accounts where owner=actor;
    if account.owner is null or account.erased or account.epoch is distinct from (args->>'epoch')::uuid then
      raise exception 'Journal no longer active' using errcode='PT410'; end if;
    if op='photo_convert' then
      -- Older clients retry on their normal interval while the maintenance worker owns conversion.
      raise exception 'Trip conversion pending' using errcode='PT503';
    end if;
    return angler_sync.photo_operation(actor,op,args);
  end if;
  if op='save' and args->>'key' like 'trip/%' and (args->>'format') is distinct from '2' and
      exists(select from angler_sync.documents where owner=actor and key=args->>'key' and photo_format) then
    raise exception 'Update the journal application' using errcode='PT426'; end if;
  if op='save' and args->>'format'='2' then
    update angler_sync.documents set legacy_base=null where owner=actor and key=args->>'key' and legacy_base is not null
      and to_jsonb(parts) is distinct from args->'parts';
  end if;
  result:=angler_sync.journal_v1(op,args);
  if op='list' then
    if (args->>'format') is distinct from '2' and exists(select from jsonb_array_elements(result->'rows') r
      join angler_sync.documents d on d.owner=actor and d.key=r->>'key' where d.photo_format and cardinality(d.parts)>0) then
      raise exception 'Update the journal application' using errcode='PT426'; end if;
    result:=result || jsonb_build_object('photoFormat',2,'photoRevision',(select photo_revision::text from angler_sync.accounts where owner=actor),'rows',(select coalesce(jsonb_agg(r ||
      jsonb_build_object('format',case when d.photo_format then 2 else 1 end,'legacy',d.legacy_base) order by d.key),'[]') from
      jsonb_array_elements(result->'rows') r join angler_sync.documents d on d.owner=actor and d.key=r->>'key'));
  elsif op='save' and args->>'key' like 'trip/%' and args->>'format'='2' then
    perform angler_sync.attach_photos(actor,args);
  end if;
  return result;
end $$;

create or replace function angler_sync.attach_photos(actor uuid,args jsonb) returns void language plpgsql set search_path='' as $$
declare k text:=args->>'key'; refs jsonb:='[]'::jsonb; ref jsonb; manifest jsonb; catches jsonb;
begin
  if jsonb_array_length(args->'parts')>0 then
    manifest:=angler_sync.document_json(actor,array(select jsonb_array_elements_text(args->'parts')));
    if manifest->>'version' is distinct from '2' or manifest->'value'->'trip'->>'id' is distinct from substr(k,6) or jsonb_typeof(manifest->'value'->'catches') is distinct from 'array' then raise exception 'Invalid detached document' using errcode='PT422'; end if;
    catches:=manifest->'value'->'catches';
    if (select count(distinct x#>>'{record,id}') from jsonb_array_elements(catches) x)<>jsonb_array_length(catches)
      or exists(select from jsonb_array_elements(catches) x where
        jsonb_typeof(x#>'{record,id}') is distinct from 'string' or length(x#>>'{record,id}') not between 1 and 200
        or x#>>'{record,tripId}' is distinct from substr(k,6)
        or x#>'{record,hasPhoto}' is distinct from to_jsonb(x->>'photoHash' is not null)
        or (x->>'photoHash') !~ '^[0-9a-f]{64}$') then raise exception 'Invalid catch manifest' using errcode='PT422'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',x#>>'{record,id}','hash',x->>'photoHash') order by i),'[]')
      into refs from jsonb_array_elements(catches) with ordinality a(x,i) where x->>'photoHash' is not null;
  end if;
  if jsonb_array_length(refs)>4096 then raise exception 'Invalid photo manifest' using errcode='PT422'; end if;
  for ref in select * from jsonb_array_elements(refs) loop
    perform 1 from angler_sync.photos where owner=actor and trip=k and catch_id=ref->>'id' and digest=ref->>'hash';
    if not found then
      if not coalesce((args->'unavailable') @> jsonb_build_array(ref),false) then
        raise exception 'Photo not ready' using errcode='PT409';
      end if;
      -- Only a referenced catch can receive a zero-byte marker. A stale phone cannot
      -- silently recreate its bytes; an explicit re-upload starts a fresh lease.
      insert into angler_sync.photos(owner,trip,catch_id,digest,size,expires,attached)
        values(actor,k,ref->>'id',ref->>'hash',0,now(),true);
    end if;
    update angler_sync.photos set attached=true where owner=actor and trip=k and catch_id=ref->>'id' and digest=ref->>'hash' and not attached;
  end loop;
  delete from angler_sync.photos p where owner=actor and trip=k and attached and not exists
    (select from jsonb_array_elements(refs) x where p.catch_id=x->>'id' and p.digest=x->>'hash');
  update angler_sync.documents set photo_format=true where owner=actor and key=k;
end $$;

create or replace function angler_sync.photo_storage(verb text, object_key uuid, body bytea default null, start_byte integer default null, end_byte integer default null)
returns bytea language plpgsql set search_path='' as $$
declare base text; secret text; reply extensions.http_response; headers extensions.http_header[]; detail jsonb;
begin
  select decrypted_secret into strict base from vault.decrypted_secrets where name='angler_storage_url';
  select decrypted_secret into strict secret from vault.decrypted_secrets where name='angler_storage_key';
  headers:=array[extensions.http_header('Authorization','Bearer '||secret),extensions.http_header('apikey',secret)];
  if start_byte is not null then
    headers:=array_append(headers,extensions.http_header('Range',format('bytes=%s-%s',start_byte,end_byte)));
  end if;
  select * into reply from extensions.http((verb,base||'/object/angler-catch-photos/'||object_key,headers,
    case when body is not null then 'image/jpeg' end,extensions.bytea_to_text(body))::extensions.http_request);
  if verb in ('GET','DELETE') and reply.status in (400,404) then
    begin detail:=reply.content::jsonb;
    exception when invalid_text_representation then detail:=null; end;
    if coalesce(detail->>'code',detail->>'error')='NoSuchKey' or (detail->>'message'='Object not found'
        and coalesce(detail->>'statusCode',reply.status::text)='404') then return null; end if;
  end if;
  if reply.status not between 200 and 299 then raise exception 'Photo storage unavailable (%)',reply.status using errcode='PT503'; end if;
  if verb='GET' then
    if start_byte is null then return extensions.text_to_bytea(reply.content); end if;
    if reply.status=200 then return substring(extensions.text_to_bytea(reply.content) from start_byte+1 for end_byte-start_byte+1); end if;
    return extensions.text_to_bytea(reply.content);
  end if;
  return null;
end $$;

create or replace function angler_sync.photo_operation(actor uuid, op text, args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare k text:=args->>'trip'; id text:=args->>'id'; h text:=args->>'hash'; p angler_sync.photos;
  raw bytea; offset_bytes int; seq int; object_key uuid; expiry timestamptz; saved boolean;
begin
  if op='photo_list' then
    return (select jsonb_build_object('revision',(select photo_revision::text from angler_sync.accounts where owner=actor),'photos',coalesce(jsonb_agg(to_jsonb(page) order by page.trip,page.id),'[]'))
      from (select trip,catch_id as id,digest as hash,cycle,expires,object_id is not null and expires>now() and retry_read_at is null as active,
        size=0 or retry_read_at is not null as missing
        from angler_sync.photos where owner=actor and attached
        and (trip,catch_id)>(coalesce(args->>'trip',''),coalesce(args->>'id',''))
        order by trip,catch_id limit 100) page);
  end if;
  if h is null or h !~ '^[0-9a-f]{64}$' or length(k) not between 6 and 250 or k not like 'trip/%'
     or k is null or id is null or length(id) not between 1 and 200 then raise exception 'Invalid photo identity' using errcode='PT422'; end if;
  select * into p from angler_sync.photos where owner=actor and trip=k and catch_id=id and digest=h;
  if op='photo_need' then return jsonb_build_object('needed',p.owner is null); end if;
  if op='photo_get' then
    if not coalesce(p.attached,false) then raise exception 'Photo manifest changed' using errcode='PT409'; end if;
    if p.retry_read_at is not null or p.object_id is null or p.expires<=clock_timestamp() then return '{"expired":true}'; end if;
    offset_bytes:=(args->>'offset')::int;
    if offset_bytes is null or offset_bytes<0 or offset_bytes>=p.size or offset_bytes%65536<>0 then raise exception 'Invalid offset' using errcode='PT422'; end if;
    -- Some Storage backends report the requested Content-Length verbatim, even past EOF.
    raw:=angler_sync.photo_storage('GET',p.object_id,null,offset_bytes,least(offset_bytes+65535,p.size-1));
    if raw is null then
      update angler_sync.photos set retry_read_at=clock_timestamp()+interval '1 day'
        where owner=actor and trip=k and catch_id=id and digest=h and object_id=p.object_id;
      return '{"expired":true}';
    end if;
    if octet_length(raw) is distinct from least(65536,p.size-offset_bytes) then raise exception 'Incomplete photo' using errcode='PT503'; end if;
    return jsonb_build_object('data',replace(encode(raw,'base64'),chr(10),''),'size',p.size);
  elsif op='photo_renew' then
    if not coalesce(p.attached,false) or p.cycle is distinct from (args->>'cycle')::uuid
       or p.retry_read_at is not null or p.object_id is null or p.expires<=clock_timestamp() then return '{"expired":true}'; end if;
    update angler_sync.photos set expires=clock_timestamp()+interval '12 months'
      where owner=actor and trip=k and catch_id=id and digest=h returning expires into expiry;
    return jsonb_build_object('expires',expiry);
  elsif op='photo_part' then
    seq:=(args->>'part')::int;
    if length(args->>'data')>87384 then raise exception 'Photo part too large' using errcode='PT413'; end if;
    raw:=decode(args->>'data','base64');
    insert into angler_sync.photo_parts(owner,digest,part,bytes) values(actor,h,seq,raw)
      on conflict(owner,digest,part) do update set bytes=excluded.bytes,created_at=now();
    if (select sum(octet_length(bytes)) from angler_sync.photo_parts where owner=actor)>33554432 then
      raise exception 'Photo staging full' using errcode='PT413'; end if;
    return '{}';
  elsif op in ('photo_prepare','photo_reupload') then
    if op='photo_prepare' and p.owner is not null then return '{}'; end if;
    if op='photo_reupload' then
      if not coalesce(p.attached,false) then raise exception 'Photo removed' using errcode='PT409'; end if;
      if p.cycle is distinct from (args->>'cycle')::uuid or (p.expires>clock_timestamp() and p.retry_read_at is null) then return '{}'; end if;
    end if;
    select string_agg(bytes,''::bytea order by part),count(*)=max(part)+1 into raw,saved
      from angler_sync.photo_parts where owner=actor and digest=h;
    if not coalesce(saved,false) or encode(sha256(raw),'hex') is distinct from h
       or substring(raw from 1 for 3)<>decode('ffd8ff','hex') then raise exception 'Invalid JPEG or missing parts' using errcode='PT409'; end if;
    object_key:=gen_random_uuid();
    insert into angler_sync.photos as current(owner,trip,catch_id,digest,object_id,size,expires)
      values(actor,k,id,h,object_key,octet_length(raw),clock_timestamp()+interval '12 months')
      on conflict(owner,trip,catch_id,digest) do update set object_id=excluded.object_id,size=excluded.size,
        expires=excluded.expires,retry_read_at=null,cycle=gen_random_uuid();
    perform angler_sync.photo_storage('POST',object_key,raw);
    delete from angler_sync.photo_parts where owner=actor and digest=h;
    return '{}';
  end if;
  raise exception 'Unknown photo operation' using errcode='PT422';
end $$;

create or replace function angler_sync.maintain_photos() returns void language plpgsql set search_path='' as $$
declare item record; rollout timestamptz; cursor_name text; scanned int:=0;
begin
  select started_at into rollout from angler_sync.photo_rollout;
  if rollout is null then return; end if;
  if not pg_try_advisory_xact_lock(104809,4) then return; end if;
  for item in select owner,key from angler_sync.documents where not photo_format and key like 'trip/%'
      and cardinality(parts)>0 and (conversion_retry is null or conversion_retry<=now())
      order by conversion_retry nulls first,owner,key limit 4 loop
    if not pg_try_advisory_xact_lock(hashtextextended(item.owner::text,13)) then continue; end if;
    begin perform angler_sync.convert_trip(item.owner,item.key,rollout);
    exception when others then
      update angler_sync.documents set conversion_retry=now()+interval '1 day' where owner=item.owner and key=item.key;
      raise warning 'Legacy photo conversion deferred: %',sqlstate;
    end;
  end loop;
  for item in select owner,trip,catch_id,digest from angler_sync.photos
      where retry_read_at<=now() or (object_id is not null and expires<=now()) or (not attached and created_at<now()-interval '1 day')
      order by expires limit 256 loop
    if not pg_try_advisory_xact_lock(hashtextextended(item.owner::text,13)) then continue; end if;
    delete from angler_sync.photos where owner=item.owner and trip=item.trip and catch_id=item.catch_id and digest=item.digest
      and not attached and created_at<now()-interval '1 day';
    -- A new photo revision lets devices retry a previously missing original after a restore.
    update angler_sync.photos set retry_read_at=null where owner=item.owner and trip=item.trip
      and catch_id=item.catch_id and digest=item.digest and retry_read_at<=now();
    update angler_sync.photos set object_id=null,retry_read_at=null where owner=item.owner and trip=item.trip and catch_id=item.catch_id
      and digest=item.digest and expires<=clock_timestamp() and object_id is not null;
  end loop;
  delete from angler_sync.photo_parts where ctid in (select ctid from angler_sync.photo_parts
    where created_at<now()-interval '1 day' limit 1024 for update skip locked);
  select orphan_cursor into cursor_name from angler_sync.photo_rollout;
  for item in select o.name from storage.objects o where bucket_id='angler-catch-photos'
    and name ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    and (cursor_name is null or name>cursor_name)
    and created_at<now()-interval '1 hour' and not exists(select from angler_sync.photos p where p.object_id=
      case when o.name ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then o.name::uuid end)
    order by name limit 128 loop
    cursor_name:=item.name; scanned:=scanned+1;
    begin perform angler_sync.photo_storage('DELETE',item.name::uuid);
    exception when others then raise warning 'Photo purge deferred: %',sqlstate; end;
  end loop;
  update angler_sync.photo_rollout set orphan_cursor=case when scanned=128 then cursor_name end where singleton;
end $$;

create or replace function public.angler_parking_remove(water_key text, point_id uuid, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); current_revision integer;
begin
  select revision into current_revision from angler_activity.parking_points
    where id=$2 and water=$1 and creator=actor for update;
  if not found then raise exception 'Point unavailable' using errcode='PT404'; end if;
  if current_revision is distinct from $3 then raise exception 'Point changed' using errcode='PT409'; end if;
  if exists(select from angler_activity.parking_reviews where point=$2 and author<>actor) then
    delete from angler_activity.parking_reviews where point=$2 and author=actor;
    update angler_activity.parking_points set creator=null,
      editor=case when editor=actor then null else editor end, revision=revision+1 where id=$2;
  else
    delete from angler_activity.parking_points where id=$2;
  end if;
  return '{}'::jsonb;
end $$;

-- Replace reusable invitations with the established single-use, rotating code.
-- Previously issued multi-use links cease to grant access. Memberships are unchanged.
delete from angler_groups_private.invitations;
create trigger limit_rotated_group_links after update of invite_hash on angler_groups_private.groups
  for each row when (new.invite_hash is not null and new.invite_hash is distinct from old.invite_hash)
  execute function angler_private.limit_write('invites','40');
create or replace function public.angler_group_link(group_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_groups_private.invite($1)$$;

create or replace function angler_groups_private.join_group(invite_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject(); fingerprint bytea := sha256(uuid_send(invite_code));
        target angler_groups_private.groups;
begin
  select * into target from angler_groups_private.groups g where g.invite_hash=fingerprint for update;
  if not found or target.invite_expires_at <= clock_timestamp() then
    if exists (select from angler_groups_private.members m where m.user_id=actor and m.joined_with=fingerprint) then
      return '{}'::jsonb;
    end if;
    raise exception 'Invitation unavailable' using errcode='22023';
  end if;
  if target.owner_id <> actor then
    insert into angler_groups_private.members(group_id,user_id,joined_with) values(target.id,actor,fingerprint)
      on conflict do nothing;
    if found then
      update angler_groups_private.groups set invite_hash=null, invite_expires_at=null where id=target.id;
    end if;
  end if;
  return '{}'::jsonb;
end;
$$;

create function public.angler_group_revoke(group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update angler_groups_private.groups set invite_hash=null,invite_expires_at=null
    where id=$1 and owner_id=angler_groups_private.subject();
  if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
  return '{}';
end $$;

create function public.angler_group_members(group_id uuid, after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select from angler_groups_private.groups where id=$1 and owner_id=angler_groups_private.subject())
    then raise exception 'Group unavailable' using errcode='42501'; end if;
  return (with batch as (
    select m.user_id,p.display_name from angler_groups_private.members m
      join angler_private.profiles p on p.user_id=m.user_id where m.group_id=$1 and ($2 is null or m.user_id>$2)
      order by m.user_id limit 26
  ), page as (select * from batch order by user_id limit 25)
  select jsonb_build_object('ownerName',(select p.display_name from angler_private.profiles p where p.user_id=auth.uid()),
      'items',coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name) order by user_id),'[]'),
      'next',case when (select count(*) from batch)>25 then max(user_id::text) end) from page);
end $$;

create function public.angler_group_remove_member(group_id uuid, member_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform from angler_groups_private.groups where id=$1 and owner_id=angler_groups_private.subject() for update;
  if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
  delete from angler_groups_private.members m where m.group_id=$1 and m.user_id=$2;
  return '{}';
end $$;
revoke all on function public.angler_group_members(uuid,uuid), public.angler_group_remove_member(uuid,uuid),
  public.angler_group_revoke(uuid) from public,anon;
grant execute on function public.angler_group_members(uuid,uuid), public.angler_group_remove_member(uuid,uuid),
  public.angler_group_revoke(uuid) to authenticated;

-- Registration, sign-in and notification subscriptions use the same legal revision.
create function angler_private.document_revision() returns text language sql immutable set search_path=''
as $$select '2026-11-26.2'::text$$;
revoke all on function angler_private.document_revision() from public,anon,authenticated;

create or replace function public.angler_registration_profile() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.user_id,'name',p.display_name,
    'ageBand',case when p.born_on is null then 'unknown' when angler_private.age_years(p.born_on)<15 then 'child'
      when angler_private.age_years(p.born_on)<18 then 'teen' else 'adult' end,
    'current',p.born_on is not null and exists(select from angler_private.acceptances a
      where a.user_id=p.user_id and a.terms_revision=angler_private.document_revision() and a.privacy_revision=angler_private.document_revision()))
  from angler_private.profiles p where p.user_id=auth.uid() and coalesce(auth.jwt()->>'is_anonymous','false')='false'
$$;

create or replace function public.angler_register(nickname text, terms text, privacy text, birth_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); registered date;
begin
  if coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists
     (select from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if terms is distinct from angler_private.document_revision() or privacy is distinct from angler_private.document_revision() then
    raise exception 'Document revision mismatch' using errcode='22023';
  end if;
  select born_on into registered from angler_private.profiles where user_id=actor for update;
  if registered is null and (birth_date is null or not isfinite(birth_date) or
       birth_date>(statement_timestamp() at time zone 'Europe/Prague')::date or angler_private.age_years(birth_date)>125) then
    raise exception 'Invalid birth date' using errcode='AN002';
  end if;
  if not found then
    if nickname collate "C" ~ U&'[\00AD\200B-\200F\202A-\202E\2060-\2064\2066-\2069\FEFF]' then
      raise exception 'Invisible display-name characters' using errcode='AN001';
    end if;
    begin
      insert into angler_private.profiles(user_id,display_name,born_on) values(actor,btrim(nickname),birth_date)
        on conflict(user_id) do nothing;
    exception when unique_violation then raise exception 'Display name already used' using errcode='PT409'; end;
  end if;
  update angler_private.profiles set born_on=birth_date where user_id=actor and born_on is null;
  select born_on into strict registered from angler_private.profiles where user_id=actor;
  if birth_date is not null and registered<>birth_date then
    raise exception 'Birth date correction requires account support' using errcode='AN002';
  end if;
  insert into angler_private.acceptances(user_id,terms_revision,privacy_revision) values(actor,terms,privacy) on conflict do nothing;
  return public.angler_registration_profile();
end $$;

create or replace function public.angler_community_signal(device_key uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid; general boolean;
begin
  select w.owner_id,angler_private.age_years(p.born_on)>=15 into actor,general
    from angler_discussions.post_watches w join angler_private.profiles p on p.user_id=w.owner_id
    join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
    where w.digest=sha256(convert_to($1::text,'UTF8')) and w.expires_at>now() and w.community
    and p.born_on is not null and exists(select from angler_private.acceptances a where a.user_id=p.user_id
      and a.terms_revision=angler_private.document_revision() and a.privacy_revision=angler_private.document_revision());
  if actor is null then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  return (with groups as (
    select g.id, general or exists(select from angler_private.group_permissions p where p.child=actor and p.group_id=g.id and p.kind='tip') as tips,
      general or exists(select from angler_private.group_permissions p where p.child=actor and p.group_id=g.id and p.kind='catch') as catches
    from angler_groups_private.groups g where g.owner_id=actor or exists(
      select from angler_groups_private.members m where m.user_id=actor and m.group_id=g.id)
  ) select jsonb_build_object(
    'messages',coalesce((select max(e.position) from angler_messages.threads t join angler_messages.entries e on e.thread=t.id
      join angler_private.profiles peer on peer.user_id=case when t.first_user=actor then t.second_user else t.first_user end
      where general and angler_private.age_years(peer.born_on)>=15 and actor in (t.first_user,t.second_user) and e.from_first<>(actor=t.first_user)
      and not (t.first_blocks or t.second_blocks) and e.position>case when t.first_user=actor then t.first_read else t.second_read end),0),
    'replies',coalesce((select max(r.position) from angler_discussions.posts q join angler_discussions.posts r on r.parent=q.id
      where general and q.author_id=actor and q.body is not null and r.author_id<>actor and r.body is not null),0),
    'tips',coalesce((select max(t.position) from angler_groups_private.tips t join groups g on g.id=t.group_id
      where g.tips and t.author_id<>actor and t.body is not null),0),
    'catches',coalesce((select max(p.position) from angler_groups_private.catch_posts p join groups g on g.id=p.group_id
      where g.catches and p.author<>actor and p.caught is not null),0),
    'weekly',coalesce((select max(e.alert_position) from angler_weekly.entries e join groups g on g.id=e.group_id
      where g.catches and e.author<>actor and not e.held and e.photo is not null),0),
    'sales',coalesce((select max(b.id) from angler_market.orders b join angler_market.offers o on o.id=b.offer where general and o.seller=actor),0),
    'ratings',coalesce((select max(b.rating_position) from angler_market.orders b join angler_market.offers o on o.id=b.offer where general and o.seller=actor),0)
  ));
end $$;

create function angler_private.check_nickname_scripts() returns trigger
language plpgsql set search_path='' as $$
declare word text; scripts integer;
begin
  if tg_op='UPDATE' and new.display_name=old.display_name then return new; end if;
  for word in select regexp_split_to_table(normalize(new.display_name,NFKC) collate pg_catalog."C.utf8",'[[:space:][:punct:]]+') loop
    scripts := (word collate "C" ~ U&'[A-Za-z\00C0-\00D6\00D8-\00F6\00F8-\02AF\1E00-\1EFF]')::int
             + (word collate "C" ~ U&'[\0370-\0373\0376-\0377\037B-\037D\0386\0388-\038A\038C\038E-\03A1\03A3-\03E1\03F0-\03FF\1F00-\1FFF]')::int
             + (word collate "C" ~ U&'[\0400-\0481\048A-\052F\A640-\A69B]')::int;
    if scripts>1 then raise exception 'Mixed writing systems within a nickname word' using errcode='23514'; end if;
  end loop;
  return new;
end $$;
revoke all on function angler_private.check_nickname_scripts() from public,anon,authenticated;
create trigger validate_nickname_scripts before insert or update of display_name on angler_private.profiles
for each row execute function angler_private.check_nickname_scripts();
