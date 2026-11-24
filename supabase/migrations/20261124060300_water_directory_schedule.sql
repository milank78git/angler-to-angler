-- Only the database scheduler contacts the repository. Clients read the installed manifest.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
create function angler_atlas.refresh() returns void
language plpgsql set search_path = '' as $$
declare
  root constant text := 'https://raw.githubusercontent.com/milank78git/angler-to-angler/';
  response extensions.http_response;
  candidate jsonb;
begin
  if not pg_try_advisory_xact_lock(104809, 1) then return; end if;
  select * into response from extensions.http_get((root || 'water-atlas-v1/manifest.json')::varchar);
  if response.status <> 200 or octet_length(response.content) > 8192 then
    raise exception 'Water manifest HTTP %',response.status;
  end if;
  candidate := response.content::jsonb;
  if candidate = public.angler_water_manifest() then return; end if;
  if (candidate->>'commit' ~ '^[a-f0-9]{40}$') is not true then
    raise exception 'Invalid water release revision';
  end if;
  select * into response from extensions.http_get((root || (candidate->>'commit') || '/registry.json')::varchar);
  if response.status <> 200 then raise exception 'Water registry HTTP %',response.status; end if;
  perform angler_atlas.install(candidate,response.content);
end $$;
revoke all on function angler_atlas.refresh() from public, anon, authenticated;
select cron.schedule('angler-water-directory','*/30 * * * *','select angler_atlas.refresh()');
