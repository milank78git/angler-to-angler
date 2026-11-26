-- Record the next scan position even when a whole batch fails. Scan only canonical
-- object keys produced by put_chunk; foreign paths belong to the storage operator.
create table angler_sync.maintenance_cursor (
  singleton boolean primary key check(singleton),
  legacy_owner uuid, legacy_hash text, object_name text,
  check ((legacy_owner is null) = (legacy_hash is null))
);
insert into angler_sync.maintenance_cursor(singleton) values(true);
alter table angler_sync.maintenance_cursor enable row level security;
revoke all on angler_sync.maintenance_cursor from public,anon,authenticated;

create or replace function angler_sync.maintain() returns void language plpgsql set search_path='' as $$
declare c record; d record; o record; allocated uuid; encoded text; ceiling bigint;
  cursor_row angler_sync.maintenance_cursor; migrations int:=0; objects int:=0;
  failed_migrations int:=0; failed_deletions int:=0;
begin
  if not pg_try_advisory_xact_lock(104809,2) then return; end if;
  select * into strict cursor_row from angler_sync.maintenance_cursor where singleton;
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
  for c in select owner,hash from angler_sync.chunks where bytes is not null and
      (cursor_row.legacy_owner is null or (owner,hash)>(cursor_row.legacy_owner,cursor_row.legacy_hash))
      order by owner,hash limit 32 loop
    cursor_row.legacy_owner:=c.owner; cursor_row.legacy_hash:=c.hash; migrations:=migrations+1;
    if not pg_try_advisory_xact_lock(hashtextextended(c.owner::text,13)) then continue; end if;
    select replace(encode(bytes,'base64'),chr(10),'') into encoded from angler_sync.chunks
      where owner=c.owner and hash=c.hash;
    if encoded is null then continue; end if;
    allocated:=gen_random_uuid();
    begin
      perform angler_sync.storage_request('POST',allocated,encoded);
      if encode(sha256(decode(angler_sync.storage_request('GET',allocated),'base64')),'hex') is distinct from c.hash then
        raise exception 'Cannot verify migrated chunk';
      end if;
    exception when others then
      failed_migrations:=failed_migrations+1;
      continue;
    end;
    update angler_sync.chunks set bytes=null,object_id=allocated where owner=c.owner and hash=c.hash;
  end loop;
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
  update angler_sync.maintenance_cursor set
    legacy_owner=case when migrations=32 then cursor_row.legacy_owner end,
    legacy_hash=case when migrations=32 then cursor_row.legacy_hash end,
    object_name=case when objects=128 then cursor_row.object_name end where singleton;
  if failed_deletions+failed_migrations>0 then
    raise warning 'Journal maintenance deferred % migrations and % object deletions',failed_migrations,failed_deletions;
  end if;
end $$;
