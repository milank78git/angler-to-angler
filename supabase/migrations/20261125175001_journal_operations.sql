create function angler_sync.list_documents(actor uuid, args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
    -- Keep each response under the Android bridge size limit while paging small manifests together.
    return (with candidates as (select key,revision,parts from angler_sync.documents
      where owner=actor and key>coalesce(args->>'after','') order by key limit 128),
      page as (select to_jsonb(c) as item, key,
        sum(octet_length(to_jsonb(c)::text)+1) over(order by key) as bytes from candidates c)
      select jsonb_build_object('rows',coalesce(jsonb_agg(item order by key) filter(where bytes<180000),'[]')) from page);
end $$;

create function angler_sync.missing_chunks(actor uuid, args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
    if jsonb_array_length(args->'hashes')>1024 then raise exception 'Too many parts'; end if;
    return jsonb_build_object('hashes',(select coalesce(jsonb_agg(value),'[]')
      from jsonb_array_elements_text(args->'hashes') where not exists
      (select from angler_sync.chunks where owner=actor and hash=value)));
end $$;

create function angler_sync.put_chunk(actor uuid, args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h text := args->>'hash'; raw bytea;
begin
    raw:=decode(args->>'data','base64');
    if raw is null or octet_length(raw) not between 1 and 65536 or h is distinct from encode(sha256(raw),'hex') then
      raise exception 'Invalid journal part' using errcode='PT422';
    end if;
    -- Incomplete uploads are recoverable. Retire abandoned and superseded data on further writes.
    delete from angler_sync.chunks c where owner=actor and touched<now()-interval '1 day'
      and not exists(select from angler_sync.documents d where d.owner=actor and c.hash=any(d.parts));
    if not exists(select from angler_sync.chunks where owner=actor and hash=h)
      and (select coalesce(sum(octet_length(bytes)),0) from angler_sync.chunks where owner=actor)+octet_length(raw)>536870912 then
      raise exception 'Journal storage full' using errcode='PT413';
    end if;
    insert into angler_sync.chunks(owner,hash,bytes) values(actor,h,raw)
      on conflict(owner,hash) do update set touched=now();
    return '{}'::jsonb;
end $$;

create function angler_sync.save_document(actor uuid, args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare k text := args->>'key'; parts_list text[]; existing angler_sync.documents;
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
    insert into angler_sync.documents as d values(actor,k,coalesce(existing.revision,0)+1,parts_list)
      on conflict(owner,key) do update set revision=excluded.revision,parts=excluded.parts;
    -- Drop replaced sensitive content as soon as its last active reference is gone.
    delete from angler_sync.chunks c where c.owner=actor and c.hash=any(existing.parts)
      and not exists(select from angler_sync.documents d where d.owner=actor and c.hash=any(d.parts));
    return jsonb_build_object('revision',coalesce(existing.revision,0)+1);
end $$;

revoke all on function
  angler_sync.list_documents(uuid,jsonb),
  angler_sync.missing_chunks(uuid,jsonb),
  angler_sync.put_chunk(uuid,jsonb),
  angler_sync.save_document(uuid,jsonb)
from public, anon, authenticated;

create or replace function angler_sync.journal(op text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := angler_groups_private.subject();
  h text := args->>'hash';
  raw bytea;
begin
  if op='enable' then
    insert into angler_sync.accounts(owner) values(actor) on conflict do nothing;
    return jsonb_build_object('enabled',true);
  elsif op='settings' then
    return jsonb_build_object('enabled',exists(select from angler_sync.accounts where owner=actor));
  elsif op='list' then return angler_sync.list_documents(actor,args);
  elsif op='missing' then return angler_sync.missing_chunks(actor,args);
  elsif op='get' then
    select bytes into strict raw from angler_sync.chunks where owner=actor and hash=h;
    return jsonb_build_object('data',replace(encode(raw,'base64'),chr(10),''));
  end if;
  -- Hold one owner lock through quota checks, chunk writes and manifest commits.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,13));
  case op
    when 'put' then return angler_sync.put_chunk(actor,args);
    when 'save' then return angler_sync.save_document(actor,args);
    else raise exception 'Unknown journal operation' using errcode='PT422';
  end case;
end $$;
