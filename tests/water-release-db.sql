\ir ../supabase/migrations/20261124060000_water_directory.sql
\ir ../supabase/migrations/20261124060100_european_water_seed.sql
do $$
declare
  entries text := '[["IE:IFI:12345","Test water","Europe/Dublin"]]';
  m jsonb := jsonb_build_object('format',1,'commit',repeat('a',40),'sha256',repeat('c',64),
    'asOf','2026-11-24','bytes',200,'unpacked',500,'registrySha256',encode(sha256(convert_to(entries,'UTF8')),'hex'));
begin
  if has_function_privilege('anon','angler_atlas.install(jsonb,text)','execute')
    or has_function_privilege('authenticated','angler_atlas.install(jsonb,text)','execute') then
    raise exception 'A phone can install a release'; end if;
  if not exists(select from angler_discussions.waters where key='IE:IFI:1') then raise exception 'Missing offline seed'; end if;
  perform angler_atlas.install(m,entries);
  perform angler_atlas.install(m,entries);
  if public.angler_water_manifest() is distinct from m or not exists (
    select from angler_public_cards.waters where key='IE:IFI:12345' and label='Test water'
  ) then raise exception 'Edition unavailable'; end if;
  begin
    perform angler_atlas.install(m,'[]');
    raise exception 'accepted damaged registry' using errcode='22000';
  exception when raise_exception then null; end;
  if public.angler_water_manifest() is distinct from m then raise exception 'Damaged registry replaced release'; end if;
end $$;
set local role anon;
do $$begin if public.angler_water_manifest() is null then raise exception 'Manifest unreadable'; end if;end$$;
reset role;
