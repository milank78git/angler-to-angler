\ir ../supabase/migrations/20261126150000_journal_maintenance.sql
\ir ../supabase/migrations/20261126181000_separate_journal_storage.sql

-- The fake Storage transport can fail an entire page. Database cleanup must still commit.
create function pg_temp.refuse_object_delete() returns trigger language plpgsql as $$
begin
  if old.content='temporarily unavailable' then raise exception 'Simulated Storage failure'; end if;
  return old;
end $$;
create trigger simulate_unavailable before delete on storage.objects
  for each row execute function pg_temp.refuse_object_delete();
do $$
declare person uuid:='00000000-0000-4000-8000-000000000085'; used_before bigint;
  unusual text:='directory/.emptyFolderPlaceholder'; healthy uuid:='ffffffff-0000-4000-8000-000000000010';
  live uuid:='eeeeeeee-0000-4000-8000-000000000011'; stale uuid:=gen_random_uuid(); recent uuid:=gen_random_uuid();
begin
  insert into storage.objects(bucket_id,name,created_at,content)
    select 'angler-journal','00000000-0000-4000-8000-'||lpad(n::text,12,'0'),now()-interval '3 days','temporarily unavailable'
    from generate_series(1,128) n;
  insert into storage.objects(bucket_id,name,created_at) values('angler-journal',unusual,now()-interval '3 days'),
    ('angler-journal',upper(live::text),now()-interval '3 days'),('angler-journal',live::text,now()-interval '3 days'),
    ('angler-journal',stale::text,now()-interval '2 days'),('angler-journal',healthy::text,now()-interval '2 days'),
    ('angler-journal',recent::text,now());
  insert into angler_sync.chunks(owner,hash,object_id,byte_count,touched)
    values(person,'live-maintenance-fixture',live,15,now()-interval '2 days');
  insert into angler_sync.documents(owner,key,revision,parts) values(person,'trip/preserved-maintenance',1,array['live-maintenance-fixture']);
  select total into strict used_before from angler_sync.usage where owner=person;
  insert into angler_sync.chunks(owner,hash,object_id,byte_count,touched)
    values(person,'stale-maintenance-fixture',stale,19,now()-interval '2 days');
  insert into angler_sync.documents(owner,key,revision,parts,changed_at)
    values(person,'trip/maintenance-tombstone',1,'{}',now()-interval '91 days');
  perform angler_sync.maintain();
  perform angler_sync.maintain_storage();
  perform pg_temp.check_that((select total=used_before from angler_sync.usage where owner=person)
    and not exists(select from angler_sync.documents where owner=person and key='trip/maintenance-tombstone'),
    'Storage failure rolled back quota or deletion history cleanup');
  perform angler_sync.maintain();
  perform angler_sync.maintain_storage();
  perform pg_temp.check_that(not exists(select from storage.objects where name in (stale::text,healthy::text))
    and (select count(*)=4 from storage.objects where name in (unusual,upper(live::text),live::text,recent::text)),
    'Failed page starved later objects or touched a protected key');
  update storage.objects set content=null where content='temporarily unavailable';
  perform angler_sync.maintain();
  perform angler_sync.maintain_storage();
  perform pg_temp.check_that(not exists(select from storage.objects where name='00000000-0000-4000-8000-000000000001'),'Recovered delete was not retried');
end $$;
drop trigger simulate_unavailable on storage.objects;
