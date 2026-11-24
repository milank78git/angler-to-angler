-- A disposable PostgreSQL instance can exercise production SQL with deterministic upstream responses.
create schema extensions;
create schema cron;
create type extensions.http_response as (status integer,content text);
create table extensions.fixture(url text primary key,status integer,body text);
create function extensions.http_get(address varchar) returns extensions.http_response
language sql as $$select status,body from extensions.fixture where url=address$$;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
\ir ../supabase/migrations/atlas-schedule-fixture.sql
do $$
declare
  root text := 'https://raw.githubusercontent.com/milank78git/angler-to-angler/';
  m jsonb := public.angler_water_manifest() || jsonb_build_object('commit',repeat('b',40));
  entries text := '[["DE:BERLIN:98765","Example section","Europe/Berlin"]]';
begin
  m := m || jsonb_build_object('registrySha256', encode(sha256(convert_to(entries,'UTF8')),'hex'));
  insert into extensions.fixture values(root||'water-atlas-v1/manifest.json',200,m::text),
    (root||(m->>'commit')||'/registry.json',200,entries);
  perform angler_atlas.refresh();
  delete from extensions.fixture where url like '%/registry.json';
  perform angler_atlas.refresh(); -- Unchanged version needs no registry download.
  update extensions.fixture set status=503;
  begin
    perform angler_atlas.refresh();
    raise exception 'accepted upstream outage' using errcode='22000';
  exception when raise_exception then null; end;
  if public.angler_water_manifest() is distinct from m then raise exception 'Lost installed version'; end if;
  if not exists(select from angler_discussions.waters where key='DE:BERLIN:98765')
    or not exists(select from angler_public_cards.waters where key='IE:IFI:12345') then
    raise exception 'Incomplete target installation or history lost'; end if;
end $$;
