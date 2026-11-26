-- Keep the deployed RPC protocol. Only the service identity can access this private bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('angler-journal','angler-journal',false,90000,array['text/plain']);
alter table angler_sync.chunks alter column bytes drop not null,
  add column object_id uuid, add column byte_count integer;
update angler_sync.chunks set byte_count=octet_length(bytes);
alter table angler_sync.chunks alter column byte_count set not null,
  add check (byte_count between 1 and 65536 and num_nonnulls(bytes,object_id)=1);
create index journal_object_ref on angler_sync.chunks(object_id) where object_id is not null;
create index journal_migration_queue on angler_sync.chunks(owner,hash) where bytes is not null;
create index journal_chunk_age on angler_sync.chunks(touched);
create index journal_chunk_refs on angler_sync.documents using gin(parts);
alter table angler_sync.documents add column changed_at timestamptz not null default now();
create index journal_deleted_at on angler_sync.documents(changed_at) where parts='{}';
alter table angler_sync.accounts add column deletion_floor bigint not null default 0;
create table angler_sync.usage (
  owner uuid primary key references angler_private.profiles(user_id) on delete cascade,
  total bigint not null check(total between 0 and 536870912)
);
alter table angler_sync.usage enable row level security;
revoke all on angler_sync.usage from public,anon,authenticated;
insert into angler_sync.usage select owner,sum(byte_count) from angler_sync.chunks group by owner;

create function angler_sync.chunk_usage() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    update angler_sync.usage set total=total-old.byte_count where owner=old.owner;
  else
    insert into angler_sync.usage as u values(new.owner,new.byte_count)
      on conflict(owner) do update set total=u.total+excluded.total;
  end if;
  return null;
exception when check_violation then raise exception 'Journal storage full' using errcode='PT413';
end $$;
create trigger journal_account_bytes after insert or delete on angler_sync.chunks
  for each row execute function angler_sync.chunk_usage();

-- Object names are generated in the database and never reused, even after a rollback or deletion.
-- Text encoding preserves all bytes across the PostgreSQL HTTP extension.
create function angler_sync.storage_request(verb text, object_id uuid, body text default null) returns text
language plpgsql set search_path='' as $$
declare base text; credential text; response extensions.http_response;
begin
  select decrypted_secret into strict base from vault.decrypted_secrets where name='angler_storage_url';
  select decrypted_secret into strict credential from vault.decrypted_secrets where name='angler_storage_key';
  select * into response from extensions.http((verb,base||'/object/angler-journal/'||object_id,
    array[extensions.http_header('Authorization','Bearer '||credential),extensions.http_header('apikey',credential)],
    case when body is not null then 'text/plain' end, body)::extensions.http_request);
  if response.status between 200 and 299 then return response.content; end if;
  raise exception 'Journal object service HTTP %', response.status using errcode='PT503';
exception when no_data_found then raise exception 'Journal storage is not configured' using errcode='PT503';
end $$;

create function angler_sync.read_chunk(actor uuid, h text) returns jsonb language plpgsql set search_path='' as $$
declare c angler_sync.chunks; encoded text;
begin
  select * into strict c from angler_sync.chunks where owner=actor and hash=h;
  encoded:=case when c.bytes is not null then replace(encode(c.bytes,'base64'),chr(10),'')
    else angler_sync.storage_request('GET',c.object_id) end;
  if encode(sha256(decode(encoded,'base64')),'hex') is distinct from h then
    raise exception 'Journal checksum mismatch' using errcode='PT503';
  end if;
  return jsonb_build_object('data',encoded);
end $$;

create or replace function angler_sync.put_chunk(actor uuid,args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h text:=args->>'hash'; raw bytea; object_key uuid;
begin
  if length(args->>'data')>90000 then raise exception 'Oversized chunk' using errcode='PT413'; end if;
  raw:=decode(args->>'data','base64');
  if raw is null or octet_length(raw) not between 1 and 65536 or encode(sha256(raw),'hex') is distinct from h then
    raise exception 'Invalid journal part' using errcode='PT422';
  end if;
  update angler_sync.chunks set touched=now() where owner=actor and hash=h;
  if not found then
    object_key:=gen_random_uuid();
    insert into angler_sync.chunks(owner,hash,object_id,byte_count) values(actor,h,object_key,octet_length(raw));
    perform angler_sync.storage_request('POST',object_key,replace(encode(raw,'base64'),chr(10),''));
  end if;
  return '{}'::jsonb;
end $$;

-- Migrate, verify and then remove each legacy bytea. A failed request leaves source bytes intact.
-- Object deletions use the Storage API; deleting only storage.objects would leak the underlying object.
create function angler_sync.maintain() returns void language plpgsql set search_path='' as $$
declare c record; d record; o record; allocated uuid; encoded text; ceiling bigint;
begin
  if not pg_try_advisory_xact_lock(104809,2) then return; end if;
  for c in select owner,hash from angler_sync.chunks where bytes is not null order by owner,hash limit 32 loop
    if not pg_try_advisory_xact_lock(hashtextextended(c.owner::text,13)) then continue; end if;
    select replace(encode(bytes,'base64'),chr(10),'') into encoded from angler_sync.chunks where owner=c.owner and hash=c.hash;
    if encoded is null then continue; end if;
    allocated:=gen_random_uuid();
    perform angler_sync.storage_request('POST',allocated,encoded);
    if encode(sha256(decode(angler_sync.storage_request('GET',allocated),'base64')),'hex') is distinct from c.hash then
      raise exception 'Cannot verify migrated chunk';
    end if;
    update angler_sync.chunks set bytes=null,object_id=allocated where owner=c.owner and hash=c.hash;
  end loop;
  for c in select owner,hash from angler_sync.chunks c0 where touched<now()-interval '1 day'
    and not exists(select from angler_sync.documents doc where doc.owner=c0.owner and doc.parts @> array[c0.hash])
    order by touched limit 128 loop
    if pg_try_advisory_xact_lock(hashtextextended(c.owner::text,13)) then
      delete from angler_sync.chunks ch where ch.owner=c.owner and ch.hash=c.hash and touched<now()-interval '1 day'
        and not exists(select from angler_sync.documents doc where doc.owner=c.owner and doc.parts @> array[c.hash]);
    end if;
  end loop;
  for d in select owner,key from angler_sync.documents where parts='{}' and changed_at<now()-interval '90 days'
    order by changed_at limit 128 loop
    if not pg_try_advisory_xact_lock(hashtextextended(d.owner::text,13)) then continue; end if;
    delete from angler_sync.documents doc where doc.owner=d.owner and doc.key=d.key and parts='{}'
      and changed_at<now()-interval '90 days' returning revision into ceiling;
    if found then
      insert into angler_sync.accounts as a(owner,deletion_floor) values(d.owner,ceiling)
        on conflict(owner) do update set deletion_floor=greatest(a.deletion_floor+1,excluded.deletion_floor);
    end if;
  end loop;
  for o in select name from storage.objects so where bucket_id='angler-journal'
    and created_at<now()-interval '1 day'
    and not exists(select from angler_sync.chunks ch where ch.object_id=so.name::uuid)
    order by created_at limit 128 loop
    perform angler_sync.storage_request('DELETE',o.name::uuid);
  end loop;
end $$;
revoke all on function angler_sync.storage_request(text,uuid,text),angler_sync.read_chunk(uuid,text),
  angler_sync.maintain(),angler_sync.chunk_usage() from public,anon,authenticated;
select cron.schedule('angler-journal-maintenance','*/5 * * * *','select angler_sync.maintain()');

create or replace function angler_sync.save_document(actor uuid, args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare k text := args->>'key'; parts_list text[]; existing angler_sync.documents; floor_value bigint; next_revision bigint;
begin
    if k is null or length(k)>250 or k !~ '^(trip|photo|pref)/.+' or jsonb_typeof(args->'parts') is distinct from 'array'
       or jsonb_array_length(args->'parts')>1024 or (args->>'revision') is null then
      raise exception 'Invalid journal document' using errcode='PT422';
    end if;
    parts_list:=array(select jsonb_array_elements_text(args->'parts'));
    if exists(select from unnest(parts_list) p where not exists(select from angler_sync.chunks where owner=actor and hash=p)) then
      raise exception 'Missing journal part' using errcode='PT409';
    end if;
    select * into existing from angler_sync.documents where owner=actor and key=k;
    if existing.parts=parts_list then return jsonb_build_object('revision',existing.revision); end if;
    if coalesce(existing.revision,0)<>(args->>'revision')::bigint then raise exception 'Journal changed' using errcode='PT409'; end if;
    select coalesce((select deletion_floor from angler_sync.accounts where owner=actor),0) into floor_value;
    if existing.key is null and coalesce((args->>'floor')::bigint,0)<>floor_value then
      raise exception 'Deletion history changed; refresh first' using errcode='PT409';
    end if;
    next_revision:=coalesce(existing.revision,floor_value)+1;
    insert into angler_sync.documents as d(owner,key,revision,parts) values(actor,k,next_revision,parts_list)
      on conflict(owner,key) do update set revision=excluded.revision,parts=excluded.parts,changed_at=now();
    -- Drop replaced sensitive content as soon as its last active reference is gone.
    delete from angler_sync.chunks c where c.owner=actor and c.hash=any(existing.parts)
      and not exists(select from angler_sync.documents d where d.owner=actor and d.parts @> array[c.hash]);
    return jsonb_build_object('revision',next_revision);
end $$;

create or replace function angler_sync.journal(op text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := angler_groups_private.subject();
  h text := args->>'hash';
begin
  if op='enable' then
    insert into angler_sync.accounts(owner) values(actor) on conflict do nothing;
    return jsonb_build_object('enabled',true);
  elsif op='settings' then
    return jsonb_build_object('enabled',exists(select from angler_sync.accounts where owner=actor));
  elsif op='list' then return angler_sync.list_documents(actor,args) || jsonb_build_object('floor',coalesce((select deletion_floor from angler_sync.accounts where owner=actor),0));
  elsif op='missing' then return angler_sync.missing_chunks(actor,args);
  elsif op='get' then
    return angler_sync.read_chunk(actor,h);
  end if;
  -- Hold one owner lock through quota checks, chunk writes and manifest commits.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,13));
  case op
    when 'put' then return angler_sync.put_chunk(actor,args);
    when 'save' then return angler_sync.save_document(actor,args);
    else raise exception 'Unknown journal operation' using errcode='PT422';
  end case;
end $$;
