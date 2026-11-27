-- Private catch originals have an independent lifetime. A manifest keeps the digest
-- after expiry, so a stale device can never silently recreate a deleted object.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('angler-catch-photos','angler-catch-photos',false,16777216,array['image/jpeg']);

create table angler_sync.photos (
  owner uuid not null references angler_sync.accounts(owner) on delete cascade,
  trip text not null, catch_id text not null, digest text not null check(digest ~ '^[0-9a-f]{64}$'),
  object_id uuid unique, size integer not null check(size between 1 and 16777216),
  expires timestamptz not null, cycle uuid not null default gen_random_uuid(),
  attached boolean not null default false, created_at timestamptz not null default now(),
  primary key(owner,trip,catch_id,digest)
);
create index journal_photo_expiry on angler_sync.photos(expires) where object_id is not null;
create index journal_pending_photos on angler_sync.photos(created_at) where not attached;
create table angler_sync.photo_parts (
  owner uuid not null references angler_sync.accounts(owner) on delete cascade,
  digest text not null, part integer not null check(part between 0 and 255),
  bytes bytea not null check(octet_length(bytes) between 1 and 65536),
  created_at timestamptz not null default now(),primary key(owner,digest,part)
);
create index journal_photo_parts_age on angler_sync.photo_parts(created_at);
alter table angler_sync.photos enable row level security;
alter table angler_sync.photo_parts enable row level security;
revoke all on angler_sync.photos,angler_sync.photo_parts from public,anon,authenticated;
alter table angler_sync.documents add column photo_format boolean not null default false;
-- The legacy deletion floor and CAS still apply to every version of a trip.

alter table angler_sync.accounts add column photo_revision bigint not null default 0;
create function angler_sync.photo_quota() returns trigger language plpgsql set search_path='' as $$
declare delta int;
begin
  delta:=case when tg_op<>'DELETE' and new.object_id is not null then new.size else 0 end
       - case when tg_op<>'INSERT' and old.object_id is not null then old.size else 0 end;
  if delta>0 then
    insert into angler_sync.usage as u values(new.owner,delta)
      on conflict(owner) do update set total=u.total+excluded.total;
  elsif delta<0 then
    update angler_sync.usage set total=total+delta where owner=old.owner;
  end if;
  update angler_sync.accounts set photo_revision=photo_revision+1 where owner=coalesce(new.owner,old.owner);
  return null;
exception when check_violation then raise exception 'Journal storage full' using errcode='PT413';
end $$;
create trigger photo_quota after insert or update of object_id,expires,attached or delete on angler_sync.photos
for each row execute function angler_sync.photo_quota();

-- Use the extension's binary-safe conversion. Storage object names are immutable,
-- server-generated UUIDs. A rollback leaves only an unreferenced object for cleanup.
create function angler_sync.photo_storage(verb text, object_key uuid, body bytea default null, start_byte integer default null)
returns bytea language plpgsql set search_path='' as $$
declare base text; secret text; reply extensions.http_response; headers extensions.http_header[];
begin
  select decrypted_secret into strict base from vault.decrypted_secrets where name='angler_storage_url';
  select decrypted_secret into strict secret from vault.decrypted_secrets where name='angler_storage_key';
  headers:=array[extensions.http_header('Authorization','Bearer '||secret),extensions.http_header('apikey',secret)];
  if start_byte is not null then
    headers:=array_append(headers,extensions.http_header('Range',format('bytes=%s-%s',start_byte,start_byte+65535)));
  end if;
  select * into reply from extensions.http((verb,base||'/object/angler-catch-photos/'||object_key,headers,
    case when body is not null then 'image/jpeg' end,extensions.bytea_to_text(body))::extensions.http_request);
  if verb='DELETE' and reply.status=404 then return null; end if;
  if reply.status not between 200 and 299 then raise exception 'Photo storage unavailable (%)',reply.status using errcode='PT503'; end if;
  if verb='GET' then
    if start_byte is null then return extensions.text_to_bytea(reply.content); end if;
    if reply.status=200 then return substring(extensions.text_to_bytea(reply.content) from start_byte+1 for 65536); end if;
    return extensions.text_to_bytea(reply.content);
  end if;
  return null;
end $$;

-- Assemble one bounded, checksum-verified image across the native RPC's 256 KiB limit.
create function angler_sync.photo_operation(actor uuid, op text, args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare k text:=args->>'trip'; id text:=args->>'id'; h text:=args->>'hash'; p angler_sync.photos;
  raw bytea; offset_bytes int; seq int; object_key uuid; expiry timestamptz; saved boolean;
begin
  if op='photo_list' then
    return (select jsonb_build_object('revision',(select photo_revision::text from angler_sync.accounts where owner=actor),'photos',coalesce(jsonb_agg(to_jsonb(page) order by page.trip,page.id),'[]'))
      from (select trip,catch_id as id,digest as hash,cycle,expires,object_id is not null and expires>now() as active
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
    if p.object_id is null or p.expires<=clock_timestamp() then return '{"expired":true}'; end if;
    offset_bytes:=(args->>'offset')::int;
    if offset_bytes is null or offset_bytes<0 or offset_bytes>=p.size or offset_bytes%65536<>0 then raise exception 'Invalid offset' using errcode='PT422'; end if;
    raw:=angler_sync.photo_storage('GET',p.object_id,null,offset_bytes);
    if octet_length(raw) is distinct from least(65536,p.size-offset_bytes) then raise exception 'Incomplete photo' using errcode='PT503'; end if;
    return jsonb_build_object('data',replace(encode(raw,'base64'),chr(10),''),'size',p.size);
  elsif op='photo_renew' then
    if not coalesce(p.attached,false) or p.cycle is distinct from (args->>'cycle')::uuid
       or p.object_id is null or p.expires<=clock_timestamp() then return '{"expired":true}'; end if;
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
      if p.cycle is distinct from (args->>'cycle')::uuid or p.expires>clock_timestamp() then return '{}'; end if;
    end if;
    select string_agg(bytes,''::bytea order by part),count(*)=max(part)+1 into raw,saved
      from angler_sync.photo_parts where owner=actor and digest=h;
    if not coalesce(saved,false) or encode(sha256(raw),'hex') is distinct from h
       or substring(raw from 1 for 3)<>decode('ffd8ff','hex') then raise exception 'Invalid JPEG or missing parts' using errcode='PT409'; end if;
    object_key:=gen_random_uuid();
    insert into angler_sync.photos as current(owner,trip,catch_id,digest,object_id,size,expires)
      values(actor,k,id,h,object_key,octet_length(raw),clock_timestamp()+interval '12 months')
      on conflict(owner,trip,catch_id,digest) do update set object_id=excluded.object_id,
        expires=excluded.expires,cycle=gen_random_uuid();
    perform angler_sync.photo_storage('POST',object_key,raw);
    delete from angler_sync.photo_parts where owner=actor and digest=h;
    return '{}';
  end if;
  raise exception 'Unknown photo operation' using errcode='PT422';
end $$;

-- Store a rollout timestamp independently of the build and upload dates. Installing
-- the migration alone does not switch existing phones to a new protocol.
create table angler_sync.photo_rollout(singleton boolean primary key check(singleton),started_at timestamptz, orphan_cursor text);
insert into angler_sync.photo_rollout(singleton) values(true);
revoke all on angler_sync.photo_rollout from public,anon,authenticated;
alter table angler_sync.documents add column conversion_retry timestamptz, add column legacy_base text;
create index journal_photo_conversion on angler_sync.documents(conversion_retry nulls first,owner,key)
  where not photo_format and key like 'trip/%' and cardinality(parts)>0;

create function angler_sync.document_json(actor uuid,parts text[]) returns jsonb language sql set search_path='' as $$
  select convert_from(string_agg(decode(angler_sync.read_chunk(actor,h)->>'data','base64'),''::bytea order by i),'UTF8')::jsonb
    from unnest(parts) with ordinality a(h,i)
$$;

-- Deterministic JSON allows an upgraded offline phone to compare existing trip
-- contents without treating object key order from PostgreSQL as a local edit.
create function angler_sync.canonical_json(value jsonb) returns text language plpgsql immutable set search_path='' as $$
begin
  case jsonb_typeof(value)
  when 'object' then return (select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||angler_sync.canonical_json(v),',' order by key collate "C"),'')||'}' from jsonb_each(value) e(key,v));
  when 'array' then return (select '['||coalesce(string_agg(angler_sync.canonical_json(v),',' order by i),'')||']' from jsonb_array_elements(value) with ordinality a(v,i));
  else return value::text;
  end case;
end $$;

create function angler_sync.convert_trip(actor uuid,doc_key text,rollout timestamptz) returns void language plpgsql set search_path='' as $$
declare doc angler_sync.documents; payload jsonb; item jsonb; value jsonb; entries jsonb:='[]';
  raw bytea; part bytea; h text; obj uuid; pos integer; parts text[]:='{}'; photos jsonb:='[]'; id text;
begin
  select * into strict doc from angler_sync.documents where owner=actor and key=doc_key;
  if doc.photo_format or cardinality(doc.parts)=0 then return; end if;
  payload:=angler_sync.document_json(actor,doc.parts); value:=payload->'value';
  if (payload->>'version') is distinct from '1' or value->'trip'->>'id' is distinct from substr(doc_key,6)
    or jsonb_typeof(value->'catches') is distinct from 'array' then raise exception 'Unrecognized legacy trip'; end if;
  -- Free logical chunk quota in the transaction before charging the binary
  -- replacement. A failed upload rolls the entire document back to its old revision.
  perform angler_sync.save_document(actor,jsonb_build_object('key',doc_key,'revision',doc.revision,'parts',jsonb_build_array()));
  for item in select * from jsonb_array_elements(value->'catches') loop
    h:=null; id:=item->'record'->>'id';
    if id is null or item->'record'->>'tripId' is distinct from substr(doc_key,6) or
      coalesce((item->'record'->>'hasPhoto')::boolean,false) is distinct from (item->'photo'->>'data' is not null)
      then raise exception 'Invalid legacy catch'; end if;
    if item->'photo'->>'data' is not null then
      raw:=decode(item->'photo'->>'data','base64');
      if substring(raw from 1 for 3)<>decode('ffd8ff','hex') or item->'photo'->>'type' is distinct from 'image/jpeg' then
        raise exception 'Unrecognized legacy image'; end if;
      h:=encode(sha256(raw),'hex');obj:=gen_random_uuid();
      insert into angler_sync.photos(owner,trip,catch_id,digest,object_id,size,expires,attached)
        values(actor,doc_key,id,h,obj,octet_length(raw),rollout+interval '12 months',true)
        on conflict(owner,trip,catch_id,digest) do update set object_id=excluded.object_id,expires=excluded.expires,attached=true;
      perform angler_sync.photo_storage('POST',obj,raw);
      if sha256(angler_sync.photo_storage('GET',obj)) is distinct from sha256(raw) then
        raise exception 'Legacy photo verification failed'; end if;
      photos:=photos||jsonb_build_array(jsonb_build_object('id',id,'hash',h));
    end if;
    entries:=entries||jsonb_build_array(jsonb_build_object('record',item->'record','photoHash',h));
  end loop;
  raw:=convert_to(angler_sync.canonical_json(jsonb_build_object('version',2,'value',
    jsonb_build_object('trip',value->'trip','catches',entries))),'UTF8');
  for pos in 0..(octet_length(raw)-1)/65536 loop
    part:=substring(raw from pos*65536+1 for 65536); h:=encode(sha256(part),'hex'); parts:=array_append(parts,h);
    perform angler_sync.put_chunk(actor,jsonb_build_object('hash',h,'data',encode(part,'base64')));
  end loop;
  perform angler_sync.save_document(actor,jsonb_build_object('key',doc_key,'revision',doc.revision+1,'parts',parts));
  update angler_sync.documents set photo_format=true,conversion_retry=null,legacy_base=encode(sha256(convert_to(array_to_string(doc.parts,','),'UTF8')),'hex') where owner=actor and key=doc_key;
end $$;
revoke all on function angler_sync.document_json(uuid,text[]),angler_sync.canonical_json(jsonb),
  angler_sync.convert_trip(uuid,text,timestamptz) from public,anon,authenticated;

-- Link staged originals to exactly one committed trip revision. Rollback undoes
-- all attachment changes if the parent manifest loses a compare-and-swap race.
create function angler_sync.attach_photos(actor uuid,args jsonb) returns void language plpgsql set search_path='' as $$
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
    if not found then raise exception 'Photo not ready' using errcode='PT409'; end if;
    update angler_sync.photos set attached=true where owner=actor and trip=k and catch_id=ref->>'id' and digest=ref->>'hash' and not attached;
  end loop;
  delete from angler_sync.photos p where owner=actor and trip=k and attached and not exists
    (select from jsonb_array_elements(refs) x where p.catch_id=x->>'id' and p.digest=x->>'hash');
  update angler_sync.documents set photo_format=true where owner=actor and key=k;
end $$;

-- Keep the existing adult check, epoch, revision and erasure paths. Old clients
-- may finish unmigrated trips, but cannot overwrite a detached manifest.
alter function angler_sync.journal(text,jsonb) rename to journal_v1;
revoke all on function angler_sync.journal_v1(text,jsonb) from public,anon,authenticated;
create function angler_sync.journal(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); result jsonb; account angler_sync.accounts; rollout timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,13));
  select started_at into rollout from angler_sync.photo_rollout;
  if rollout is null then return angler_sync.journal_v1(op,args); end if;
  if op like 'photo\_%' escape '\' then
    select * into account from angler_sync.accounts where owner=actor;
    if account.owner is null or account.erased or account.epoch is distinct from (args->>'epoch')::uuid then
      raise exception 'Journal no longer active' using errcode='PT410'; end if;
    if op='photo_convert' then
      if not exists(select from angler_sync.documents where owner=actor and key=args->>'key' and revision=(args->>'revision')::bigint
          and key like 'trip/%') then raise exception 'Trip changed' using errcode='PT409'; end if;
      perform angler_sync.convert_trip(actor,args->>'key',rollout);
      return '{}';
    end if;
    return angler_sync.photo_operation(actor,op,args);
  end if;
  if op='save' and args->>'key' like 'trip/%' and (args->>'format') is distinct from '2' and
      exists(select from angler_sync.documents where owner=actor and key=args->>'key' and photo_format) then
    raise exception 'Update the journal application' using errcode='PT426'; end if;
  if op='erase' then
    delete from angler_sync.photos where owner=actor;
    delete from angler_sync.photo_parts where owner=actor;
  end if;
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
create or replace function public.angler_journal_sync(op text,args jsonb) returns jsonb language sql set search_path=''
as $$select angler_sync.journal(op,args)$$;
revoke all on function angler_sync.journal(text,jsonb),angler_sync.photo_operation(uuid,text,jsonb),
  angler_sync.photo_storage(text,uuid,bytea,integer),angler_sync.photo_quota(),angler_sync.attach_photos(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function angler_sync.journal(text,jsonb) to authenticated;

-- Expiry markers outlive the bytes. Reject renewal at the deadline regardless of
-- maintenance lag. Orphan scanning also collects account deletions and rolled back uploads.
create function angler_sync.maintain_photos() returns void language plpgsql set search_path='' as $$
declare item record; rollout timestamptz; cursor_name text; scanned int:=0;
begin
  select started_at into rollout from angler_sync.photo_rollout;
  if rollout is null then return; end if;
  if not pg_try_advisory_xact_lock(104809,3) then return; end if;
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
      where (object_id is not null and expires<=now()) or (not attached and created_at<now()-interval '1 day')
      order by expires limit 256 loop
    if not pg_try_advisory_xact_lock(hashtextextended(item.owner::text,13)) then continue; end if;
    delete from angler_sync.photos where owner=item.owner and trip=item.trip and catch_id=item.catch_id and digest=item.digest
      and not attached and created_at<now()-interval '1 day';
    update angler_sync.photos set object_id=null where owner=item.owner and trip=item.trip and catch_id=item.catch_id
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
revoke all on function angler_sync.maintain_photos() from public,anon,authenticated;
select cron.schedule('angler-photo-maintenance','*/5 * * * *','select angler_sync.maintain_photos()');
