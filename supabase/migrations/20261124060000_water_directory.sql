-- Expose a release only after all of its report, discussion and marketplace targets exist.
create schema angler_atlas;
revoke all on schema angler_atlas from public, anon, authenticated;
create table angler_atlas.release (
  singleton boolean primary key default true check (singleton),
  manifest jsonb not null
);
alter table angler_atlas.release enable row level security;

create function public.angler_water_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select manifest from angler_atlas.release where singleton;
$$;
revoke all on function public.angler_water_manifest() from public;
grant execute on function public.angler_water_manifest() to anon, authenticated;

create function angler_atlas.install(candidate jsonb, registry_text text) returns void
language plpgsql set search_path = '' as $$
declare
  entries jsonb;
begin
  if (candidate->>'format' = '1'
      and candidate->>'commit' ~ '^[a-f0-9]{40}$'
      and candidate->>'sha256' ~ '^[a-f0-9]{64}$'
      and candidate->>'asOf' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (candidate->>'bytes')::int between 1 and 16777216
      and (candidate->>'unpacked')::int between 1 and 50331648
      and octet_length(registry_text) between 2 and 16777216
      and candidate->>'registrySha256' = encode(sha256(convert_to(registry_text,'UTF8')),'hex')) is not true then
    raise exception 'Invalid water directory manifest or registry checksum';
  end if;
  entries := registry_text::jsonb;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) = 0 then
    raise exception 'Empty water directory';
  end if;
  if exists (
    select from jsonb_array_elements(entries) e
    left join (select distinct name from pg_catalog.pg_timezone_names) z on z.name = e->>2
    where (jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 3
      and e->>0 ~ '^[A-Z]{2}:[A-Z0-9]+:[A-Za-z0-9._-]{1,100}$'
      and length(trim(e->>1)) between 1 and 400 and z.name is not null) is not true
  ) then raise exception 'Invalid water identity, label or timezone'; end if;
  insert into angler_discussions.waters(key,zone)
    select e->>0,e->>2 from jsonb_array_elements(entries) e
    on conflict (key) do update set zone=excluded.zone where angler_discussions.waters.zone<>excluded.zone;
  insert into angler_public_cards.waters(key,label)
    select e->>0,e->>1 from jsonb_array_elements(entries) e
    on conflict (key) do update set label=excluded.label where angler_public_cards.waters.label<>excluded.label;
  insert into angler_atlas.release(singleton,manifest) values(true,candidate)
    on conflict(singleton) do update set manifest=excluded.manifest;
end $$;
revoke all on function angler_atlas.install(jsonb,text) from public, anon, authenticated;
