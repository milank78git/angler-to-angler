-- Published copies have an independent random link. Only the owner can list, create or retire them.
create schema angler_public_cards;
revoke all on schema angler_public_cards from public, anon, authenticated;
grant usage on schema angler_public_cards to anon, authenticated;

create table angler_public_cards.waters (
  key text primary key references angler_discussions.waters(key), label text not null
);
insert into angler_public_cards.waters values ('CZ:401001','Berounka 1 · 401 001'),('CZ:401009','Sázava 1 · 401 009');
create table angler_public_cards.cards (
  token uuid primary key default gen_random_uuid(),
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  request uuid not null, source_id uuid not null,
  position bigint generated always as identity unique,
  details jsonb, pixels bytea, unique(author,request),
  check (pixels is null or details is not null)
);
create unique index public_card_active on angler_public_cards.cards(author,source_id) where details is not null;
create index public_card_owner_list on angler_public_cards.cards(author,position desc) where details is not null;
alter table angler_public_cards.waters enable row level security;
alter table angler_public_cards.cards enable row level security;
revoke all on all tables in schema angler_public_cards from public,anon,authenticated;

create function angler_public_cards.owner_item(link uuid,details jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',link,'url','https://rybari-sobe-ulovky.richpopcorn17.chatgpt.site/#'||link,
    'species',details->>'species','date',details->>'date','precision',details->>'precision')
$$;

create function angler_public_cards.options(source uuid,water_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return jsonb_build_object('name',(select display_name from angler_private.profiles where user_id=actor),
    'water',(select label from angler_public_cards.waters where key=water_key),
    'proof',(select jsonb_build_object('mm',length_mm,'kind',outcome,'species',species)
      from angler_private.catch_evidence where user_id=actor and catch_id=source and outcome in ('measured','estimated')),
    'active',(select angler_public_cards.owner_item(token,details) from angler_public_cards.cards
      where author=actor and source_id=source and details is not null));
end
$$;

-- Compare the proposed public document with a server-built allowlist. Never persist or return
-- whole journal/profile/evidence rows. A month-only card accepts only a YYYY-MM string.
create function angler_public_cards.publish(source uuid,request_id uuid,draft jsonb,water_key text,image text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); previous angler_public_cards.cards;
  expected jsonb; proof jsonb; fish_species text:=draft->>'species'; shown text:=draft->>'date';
  precision_name text:=draft->>'precision'; day date; pixels bytea; nickname text; water_name text;
begin
  if source is null or request_id is null or draft is null or jsonb_typeof(draft)<>'object' or
      length(draft::text)>1200 or length(image)>65536 then raise exception 'Invalid card' using errcode='PT422'; end if;
  if image is not null then
    pixels:=decode(image,'base64');
    if not angler_weekly.webp(pixels) then raise exception 'Invalid photo' using errcode='PT422'; end if;
  end if;
  -- Serialize concurrent retries, withdrawal, and different requests for the same catch.
  select display_name into nickname from angler_private.profiles where user_id=actor for update;
  select * into previous from angler_public_cards.cards where author=actor and request=request_id;
  if found then
    if previous.source_id=source and previous.details=draft and previous.pixels is not distinct from pixels then
      return angler_public_cards.owner_item(previous.token,previous.details);
    end if;
    raise exception 'Request already used' using errcode='PT409';
  end if;
  if fish_species is null or length(fish_species) not between 1 and 100 or btrim(fish_species)='' or
    (precision_name='month' and shown ~ '^[0-9]{4}-[0-9]{2}$' or
     precision_name='day' and shown ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') is not true then
    raise exception 'Invalid catch or date' using errcode='PT422'; end if;
  day:=(case when precision_name='month' then shown||'-01' else shown end)::date;
  if day<date '0001-01-01' or day>(now() at time zone 'Pacific/Kiritimati')::date then
    raise exception 'Invalid date' using errcode='PT422'; end if;
  select label into water_name from angler_public_cards.waters where key=water_key;
  if water_key is not null and water_name is null then raise exception 'Unknown water' using errcode='PT422'; end if;
  if draft ? 'length' then
    select jsonb_build_object('mm',length_mm,'kind',outcome) into proof from angler_private.catch_evidence
      where user_id=actor and catch_id=source and outcome in ('measured','estimated') and catch_evidence.species=fish_species
      for share;
    if proof is null then raise exception 'Review changed' using errcode='PT409'; end if;
  end if;
  expected:=jsonb_strip_nulls(jsonb_build_object('name',nickname,'species',fish_species,'date',shown,
    'precision',precision_name,'water',water_name,'length',proof));
  if draft<>expected then raise exception 'Preview changed' using errcode='PT409'; end if;
  insert into angler_public_cards.cards(author,request,source_id,details,pixels)
    values(actor,request_id,source,expected,pixels) on conflict do nothing returning * into previous;
  if not found then raise exception 'Catch already published' using errcode='PT409'; end if;
  return angler_public_cards.owner_item(previous.token,previous.details);
end
$$;

create function angler_public_cards.mine(cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return (with batch as (select position,angler_public_cards.owner_item(token,details) item from angler_public_cards.cards
      where author=actor and details is not null and (cursor_pos is null or position<cursor_pos) order by position desc limit 21),
    shown as (select * from batch order by position desc limit 20)
    select jsonb_build_object('items',coalesce(jsonb_agg(item order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>20 then min(position)::text end) from shown);
end
$$;
create function angler_public_cards.withdraw(link uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  perform from angler_private.profiles where user_id=actor for update;
  update angler_public_cards.cards set details=null,pixels=null where token=link and author=actor;
  if not found then raise exception 'Card unavailable' using errcode='PT404'; end if;
  return '{}'::jsonb;
end
$$;

-- This is the entire anonymous read surface. Missing, withdrawn and erased links all resolve to null.
create function angler_public_cards.read_link(link uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select details || case when pixels is null then '{}'::jsonb else
    jsonb_build_object('photo',replace(encode(pixels,'base64'),chr(10),'')) end
    from angler_public_cards.cards where token=link and details is not null
$$;
create function public.angler_public_card_options(catch_id uuid,water_key text default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_public_cards.options(catch_id,water_key)$$;
create function public.angler_public_card_publish(catch_id uuid,request_id uuid,draft jsonb,water_key text default null,photo text default null)
returns jsonb language sql security invoker set search_path='' as $$select angler_public_cards.publish(catch_id,request_id,draft,water_key,photo)$$;
create function public.angler_public_cards(before_position bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_public_cards.mine(before_position)$$;
create function public.angler_public_card_withdraw(link_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_public_cards.withdraw(link_id)$$;
create function public.angler_open_catch_card(link_id uuid) returns jsonb language sql stable security invoker
set search_path='' as $$select angler_public_cards.read_link(link_id)$$;
revoke all on all functions in schema angler_public_cards from public,anon,authenticated;
grant execute on function angler_public_cards.read_link(uuid) to anon,authenticated;
grant execute on function angler_public_cards.options(uuid,text),angler_public_cards.mine(bigint),
  angler_public_cards.publish(uuid,uuid,jsonb,text,text),angler_public_cards.withdraw(uuid) to authenticated;
revoke all on function public.angler_public_card_options(uuid,text),public.angler_public_card_publish(uuid,uuid,jsonb,text,text),
  public.angler_public_cards(bigint),public.angler_public_card_withdraw(uuid),public.angler_open_catch_card(uuid) from public,anon,authenticated;
grant execute on function public.angler_open_catch_card(uuid) to anon,authenticated;
grant execute on function public.angler_public_card_options(uuid,text),public.angler_public_card_publish(uuid,uuid,jsonb,text,text),
  public.angler_public_cards(bigint),public.angler_public_card_withdraw(uuid) to authenticated;
