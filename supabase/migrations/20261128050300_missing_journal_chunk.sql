-- Translate a missing owner-scoped chunk into the same 404 for an absent or foreign hash.
-- Storage outages and checksum failures retain their service error so a restore can be retried.
create or replace function angler_sync.read_chunk(actor uuid, h text) returns jsonb
language plpgsql set search_path='' as $$
declare
  chunk angler_sync.chunks;
  encoded text;
begin
  select * into chunk from angler_sync.chunks where owner=actor and hash=h;
  if not found then
    raise exception 'Journal chunk not found' using errcode='PT404';
  end if;

  -- Existing journals may retain inline bytes. Newer chunks use a private storage object.
  encoded := case when chunk.bytes is not null then replace(encode(chunk.bytes,'base64'),chr(10),'')
    else angler_sync.storage_request('GET',chunk.object_id) end;
  if encode(sha256(decode(encoded,'base64')),'hex') is distinct from h then
    raise exception 'Journal checksum mismatch' using errcode='PT503';
  end if;
  return jsonb_build_object('data',encoded);
end $$;
