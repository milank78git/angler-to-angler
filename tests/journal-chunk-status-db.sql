\ir ../supabase/migrations/20261128050300_missing_journal_chunk.sql

-- Put one owned chunk beside a deliberately inconsistent test row to distinguish misses from damaged data.
do $$
declare
  owner_id uuid;
  peer_id uuid;
  payload bytea := convert_to('private chunk status fixture','UTF8');
  present text := encode(sha256(payload),'hex');
  damaged text := encode(sha256(convert_to('other bytes','UTF8')),'hex');
  missing_hash text;
begin
  perform pg_temp.as_user(85); owner_id := auth.uid();
  perform pg_temp.as_user(83); peer_id := auth.uid();
  insert into angler_sync.chunks(owner,hash,bytes,byte_count)
    values(owner_id,present,payload,length(payload)),(owner_id,damaged,payload,length(payload));
  perform pg_temp.check_that(angler_sync.read_chunk(owner_id,present) =
    jsonb_build_object('data',encode(payload,'base64')),'Owner could not restore the original bytes');

  -- An existing foreign chunk and a value missing for everyone have the same public failure contract.
  foreach missing_hash in array array[present, repeat('0',64)] loop
    begin
      perform angler_sync.read_chunk(peer_id,missing_hash);
      raise exception 'Unexpected chunk returned';
    exception when sqlstate 'PT404' then
      perform pg_temp.check_that(sqlerrm='Journal chunk not found','Missing chunk disclosures differ');
    end;
  end loop;
  begin
    perform angler_sync.read_chunk(owner_id,damaged);
    raise exception 'Damaged bytes were returned';
  exception when sqlstate 'PT503' then null;
  end;
  delete from angler_sync.chunks where owner=owner_id and hash in (present,damaged);
end $$;
