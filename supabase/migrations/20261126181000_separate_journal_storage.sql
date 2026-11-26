-- This cron transaction only touches PostgreSQL. Account locks end before Storage I/O.
create or replace function angler_sync.maintain() returns void language plpgsql set search_path='' as $$
declare c record; d record; ceiling bigint;
begin
  if not pg_try_advisory_xact_lock(104809,2) then return; end if;
  -- Free logical quota first; obsolete chunks do not need to be uploaded.
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
end $$;

-- One independent worker owns the scan cursors. Never hold an account or chunk
-- write lock while waiting for DELETE, upload, or read-back verification.
create function angler_sync.maintain_storage() returns void language plpgsql set search_path='' as $$
declare cursor_row angler_sync.maintenance_cursor; o record; c record; allocated uuid;
  objects int:=0; migrations int:=0; failed_deletions int:=0; failed_migrations int:=0;
  owners uuid[]:='{}'; hashes text[]:='{}'; verified uuid[]:='{}';
begin
  if not pg_try_advisory_xact_lock(104809,3) then return; end if;
  select * into strict cursor_row from angler_sync.maintenance_cursor where singleton;
  for o in select so.name, key.id from storage.objects so
    cross join lateral (select substring(so.name from
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::uuid as id) key
    where so.bucket_id='angler-journal' and so.created_at<now()-interval '1 day' and key.id is not null
      and (cursor_row.object_name is null or so.name>cursor_row.object_name)
      and not exists(select from angler_sync.chunks ch where ch.object_id=key.id)
    order by so.name limit 128 loop
    cursor_row.object_name:=o.name; objects:=objects+1;
    begin
      perform angler_sync.storage_request('DELETE',o.id);
    exception when others then
      failed_deletions:=failed_deletions+1;
    end;
  end loop;
  for c in select owner,hash,bytes from angler_sync.chunks where bytes is not null and
      (cursor_row.legacy_owner is null or (owner,hash)>(cursor_row.legacy_owner,cursor_row.legacy_hash))
      order by owner,hash limit 32 loop
    cursor_row.legacy_owner:=c.owner; cursor_row.legacy_hash:=c.hash; migrations:=migrations+1;
    allocated:=gen_random_uuid();
    begin
      perform angler_sync.storage_request('POST',allocated,replace(encode(c.bytes,'base64'),chr(10),''));
      if encode(sha256(decode(angler_sync.storage_request('GET',allocated),'base64')),'hex') is distinct from c.hash then
        raise exception 'Cannot verify migrated chunk';
      end if;
      owners:=array_append(owners,c.owner);
      hashes:=array_append(hashes,c.hash);
      verified:=array_append(verified,allocated);
    exception when others then
      failed_migrations:=failed_migrations+1;
    end;
  end loop;
  -- A concurrent withdrawal wins. Unattached opaque objects age into the orphan sweep.
  update angler_sync.chunks ch set bytes=null,object_id=batch.id
    from unnest(owners,hashes,verified) as batch(owner,hash,id)
    where ch.owner=batch.owner and ch.hash=batch.hash and ch.bytes is not null;
  update angler_sync.maintenance_cursor set
    legacy_owner=case when migrations=32 then cursor_row.legacy_owner end,
    legacy_hash=case when migrations=32 then cursor_row.legacy_hash end,
    object_name=case when objects=128 then cursor_row.object_name end where singleton;
  if failed_deletions+failed_migrations>0 then
    raise warning 'Journal maintenance deferred % migrations and % object deletions',failed_migrations,failed_deletions;
  end if;
end $$;

revoke all on function angler_sync.maintain_storage() from public,anon,authenticated;
select cron.schedule('angler-journal-storage-maintenance','*/5 * * * *','select angler_sync.maintain_storage()');
