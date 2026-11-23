-- Each account owns one optional card. An absent row represents the original blank profile.
create table angler_private.profile_cards (
  user_id uuid primary key references angler_private.profiles(user_id) on delete cascade,
  hometown text not null check (char_length(hometown) <= 80),
  tagline text not null check (char_length(tagline) <= 100),
  biography text not null check (char_length(biography) <= 600),
  avatar_id integer not null check (avatar_id between 0 and 50),
  photo bytea check (photo is null or (
    avatar_id=0 and octet_length(photo) between 4 and 65536
    and substring(photo from 1 for 3)=decode('ffd8ff','hex')
    and substring(photo from octet_length(photo)-1 for 2)=decode('ffd9','hex'))),
  shared boolean not null default false,
  revision integer not null default 1
);
alter table angler_private.profile_cards enable row level security;
revoke all on angler_private.profile_cards from public, anon, authenticated;

-- Reviewers are assigned by the pilot operator, never by the mobile client.
create table angler_private.catch_reviewers (
  user_id uuid primary key references angler_private.profiles(user_id) on delete cascade
);
create table angler_private.catch_evidence (
  user_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  catch_id uuid not null, species text not null check(char_length(species) between 1 and 100),
  captured_at timestamptz not null, submitted_at timestamptz not null default now(),
  water text, photo bytea, fingerprint bytea not null unique, lat100 integer, lon100 integer, accuracy integer,
  outcome text not null default 'pending' check(outcome in ('pending','measured','estimated','unverified')),
  length_mm integer, reviewed_at timestamptz, reviewer uuid,
  primary key(user_id,catch_id),
  check (reviewer is distinct from user_id),
  check ((outcome='pending')=(photo is not null)),
  check ((outcome in ('measured','estimated'))=(length_mm is not null))
);
create index evidence_queue on angler_private.catch_evidence(submitted_at,user_id,catch_id) where outcome='pending';
alter table angler_private.catch_evidence enable row level security;
alter table angler_private.catch_reviewers enable row level security;
revoke all on angler_private.catch_evidence,angler_private.catch_reviewers from public,anon,authenticated;

create function angler_groups_private.submit_evidence(catch_id uuid,species text,water text,trip_day date,trip_zone text,captured bigint,fixed bigint,
  lat100 integer,lon100 integer,accuracy integer,photo text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject(); pixels bytea; fingerprint bytea;
        stamp timestamptz := to_timestamp(captured/1000.0); previous angler_private.catch_evidence;
begin
  if photo is null or length(photo)>245760 then raise exception 'Invalid image' using errcode='22023'; end if;
  pixels:=decode(photo,'base64'); fingerprint:=sha256(pixels);
  perform 1 from angler_private.profiles p where p.user_id=actor for update;
  select * into previous from angler_private.catch_evidence e where e.user_id=actor and e.catch_id=$1;
  if found then
    if previous.fingerprint=fingerprint then return jsonb_build_object('outcome',previous.outcome); end if;
    raise exception 'Different submission already exists' using errcode='PT409';
  end if;
  if (stamp between now()-interval '7 days' and now()+interval '2 minutes'
      and char_length(btrim(water)) between 1 and 100 and (stamp at time zone trip_zone)::date=trip_day
      and abs(captured::numeric-fixed::numeric)<=120000 and lat100 between -9000 and 9000
      and lon100 between -18000 and 18000 and accuracy between 0 and 100
      and octet_length(pixels) between 5 and 184320 and substring(pixels from 1 for 3)=decode('ffd8ff','hex')
      and substring(pixels from octet_length(pixels)-1 for 2)=decode('ffd9','hex')) is not true then
    raise exception 'Insufficient capture evidence' using errcode='22023';
  end if;
  if (select count(*) from angler_private.catch_evidence e where e.user_id=actor and e.outcome='pending')>=10 then
    raise exception 'Pending review limit' using errcode='PT429';
  end if;
  insert into angler_private.catch_evidence(user_id,catch_id,species,water,captured_at,photo,fingerprint,lat100,lon100,accuracy)
    values(actor,$1,btrim($2),btrim($3),stamp,pixels,fingerprint,$8,$9,$10);
  return jsonb_build_object('outcome','pending');
exception when unique_violation then raise exception 'Image already submitted' using errcode='PT409';
end;
$$;

create function angler_groups_private.evidence_list(before_time timestamptz,before_id uuid,only_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject(); result jsonb;
begin
  with page as (select * from angler_private.catch_evidence e where e.user_id=actor and (only_id is null or e.catch_id=only_id) and
    (before_time is null or (e.submitted_at,e.catch_id)<(before_time,before_id))
    order by submitted_at desc,catch_id desc limit 21), shown as
    (select * from page order by submitted_at desc,catch_id desc limit 20)
  select jsonb_build_object('reviewer',exists(select from angler_private.catch_reviewers r where r.user_id=actor),
    'more',(select count(*)>20 from page),'items',coalesce(jsonb_agg(jsonb_build_object('id',catch_id,
    'species',species,'captured',captured_at,'submitted',submitted_at,'outcome',outcome,'mm',length_mm)
    order by submitted_at desc,catch_id desc),'[]'::jsonb)) into result from shown;
  return result;
end;
$$;

create function angler_groups_private.review_actor() returns uuid language plpgsql stable set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  if not exists(select from angler_private.catch_reviewers r where r.user_id=actor) then
    raise exception 'Reviewer required' using errcode='42501';
  end if;
  return actor;
end;
$$;
revoke all on function angler_groups_private.review_actor() from public,anon,authenticated;

create function angler_groups_private.review_next() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := angler_groups_private.review_actor(); result jsonb;
begin
  select jsonb_build_object('owner',user_id,'id',catch_id,'species',species,'captured',captured_at,
    'water',water,'lat100',lat100,'lon100',lon100,'accuracy',accuracy,'photo',replace(encode(photo,'base64'),chr(10),''))
    into result from angler_private.catch_evidence where outcome='pending' and user_id<>actor
    order by submitted_at,user_id,catch_id limit 1;
  return jsonb_build_object('item',result);
end;
$$;

create function angler_groups_private.decide_evidence(owner_id uuid,catch_id uuid,outcome text,length_mm integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.review_actor();
begin
  if ($3 in ('measured','estimated') and $4 between 1 and 20000 or $3='unverified' and $4 is null) is not true then
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  update angler_private.catch_evidence e set outcome=$3,length_mm=$4,reviewer=actor,reviewed_at=now(),
    water=null,photo=null,lat100=null,lon100=null,accuracy=null
    where e.user_id=$1 and e.catch_id=$2 and e.user_id<>actor and e.outcome='pending';
  if not found then raise exception 'Review no longer available' using errcode='PT409'; end if;
  return '{}'::jsonb;
end;
$$;

create function angler_groups_private.remove_evidence(catch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  delete from angler_private.catch_evidence e where e.user_id=actor and e.catch_id=$1;
  return '{}'::jsonb;
end;
$$;

create index profile_cards_directory on angler_private.profile_cards(user_id) where shared;

-- A published card is visible only to a verified pilot account. Private group names
-- stay inside the group even when one of its members publishes a card.
create function angler_groups_private.card(profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); target uuid := coalesce(profile_id, actor); result jsonb;
begin
  select jsonb_build_object(
    'id',p.user_id,'name',p.display_name,'hometown',coalesce(c.hometown,''),
    'tagline',coalesce(c.tagline,''),'biography',coalesce(c.biography,''),
    'avatar',coalesce(c.avatar_id,0),'photo',replace(encode(c.photo,'base64'),chr(10),''),
    'shared',coalesce(c.shared,false),'revision',case when target=actor then coalesce(c.revision,0) end,
    'verifiedCount',(select count(*) from angler_private.catch_evidence e where e.user_id=target and e.outcome in ('measured','estimated')),
    'groups',coalesce((select jsonb_agg(g.name order by g.name,g.id)
      from angler_groups_private.groups g
      where (g.owner_id=target or exists(select from angler_groups_private.members m where m.group_id=g.id and m.user_id=target))
        and (target=actor or g.owner_id=actor or exists(select from angler_groups_private.members m where m.group_id=g.id and m.user_id=actor))
    ),'[]'::jsonb)
  ) into result from angler_private.profiles p left join angler_private.profile_cards c on c.user_id=p.user_id
  where p.user_id=target and (target=actor or c.shared);
  if result is null then raise exception 'Profile unavailable' using errcode='PT404'; end if;
  return result;
end;
$$;

-- The directory lists names without transferring private photos in bulk. The last
-- returned UUID is an exclusive cursor, including when another card is unpublished.
create function angler_groups_private.directory(after_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); result jsonb;
begin
  with page as (
    select p.user_id,p.display_name,c.avatar_id from angler_private.profile_cards c
    join angler_private.profiles p on c.user_id=p.user_id
    where c.shared and p.user_id<>actor and (after_id is null or p.user_id>after_id)
    order by p.user_id limit 21
  ), shown as (select * from page order by user_id limit 20)
  select jsonb_build_object('profiles',coalesce(jsonb_agg(jsonb_build_object(
    'id',user_id,'name',display_name,'avatar',avatar_id) order by user_id),'[]'::jsonb),
    'more',(select count(*)>20 from page)) into result from shown;
  return result;
end;
$$;

-- Full replacement makes removal of an old picture explicit. Optimistic revision
-- checks prevent a stale device from publishing or overwriting a newer profile.
create function angler_groups_private.save_card(expected integer, hometown text, tagline text,
  biography text, avatar integer, photo text, shared boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); pixels bytea; version integer;
begin
  if expected is null or expected<0 or length(photo)>87384 then
    raise exception 'Invalid profile' using errcode='22023';
  end if;
  pixels := decode(photo,'base64');
  if expected=0 then
    insert into angler_private.profile_cards(user_id,hometown,tagline,biography,avatar_id,photo,shared)
      values(actor,btrim(hometown),btrim(tagline),btrim(biography),avatar,pixels,shared)
      on conflict(user_id) do nothing returning revision into version;
  else
    update angler_private.profile_cards c set hometown=btrim($2),tagline=btrim($3),biography=btrim($4),
      avatar_id=$5,photo=pixels,shared=$7,revision=c.revision+1
      where c.user_id=actor and c.revision=expected returning c.revision into version;
  end if;
  if version is null then raise exception 'Profile changed' using errcode='PT409'; end if;
  return jsonb_build_object('revision',version);
end;
$$;

create function public.angler_card(profile_id uuid default null) returns jsonb language sql stable security invoker set search_path=''
  as $$select angler_groups_private.card($1)$$;
create function public.angler_directory(after_id uuid default null) returns jsonb language sql stable security invoker set search_path=''
  as $$select angler_groups_private.directory($1)$$;
create function public.angler_save_card(expected integer,hometown text,tagline text,biography text,avatar integer,photo text,shared boolean)
  returns jsonb language sql security invoker set search_path='' as $$select angler_groups_private.save_card($1,$2,$3,$4,$5,$6,$7)$$;

revoke all on function angler_groups_private.card(uuid),angler_groups_private.directory(uuid),
  angler_groups_private.save_card(integer,text,text,text,integer,text,boolean),
  public.angler_card(uuid),public.angler_directory(uuid),public.angler_save_card(integer,text,text,text,integer,text,boolean) from public,anon;
grant execute on function angler_groups_private.card(uuid),angler_groups_private.directory(uuid),
  angler_groups_private.save_card(integer,text,text,text,integer,text,boolean),
  public.angler_card(uuid),public.angler_directory(uuid),public.angler_save_card(integer,text,text,text,integer,text,boolean) to authenticated;

create function public.angler_evidence_submit(catch_id uuid,species text,water text,trip_day date,trip_zone text,captured bigint,fixed bigint,lat100 integer,lon100 integer,accuracy integer,photo text) returns jsonb
language sql security invoker set search_path='' as $$select angler_groups_private.submit_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)$$;
revoke all on function public.angler_evidence_submit(uuid,text,text,date,text,bigint,bigint,integer,integer,integer,text), angler_groups_private.submit_evidence(uuid,text,text,date,text,bigint,bigint,integer,integer,integer,text) from public,anon;
grant execute on function public.angler_evidence_submit(uuid,text,text,date,text,bigint,bigint,integer,integer,integer,text), angler_groups_private.submit_evidence(uuid,text,text,date,text,bigint,bigint,integer,integer,integer,text) to authenticated;

create function public.angler_evidence_list(before_time timestamptz,before_id uuid,only_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_groups_private.evidence_list($1,$2,$3)$$;
revoke all on function public.angler_evidence_list(timestamptz,uuid,uuid), angler_groups_private.evidence_list(timestamptz,uuid,uuid) from public,anon;
grant execute on function public.angler_evidence_list(timestamptz,uuid,uuid), angler_groups_private.evidence_list(timestamptz,uuid,uuid) to authenticated;

create function public.angler_evidence_review() returns jsonb
language sql stable security invoker set search_path='' as $$select angler_groups_private.review_next()$$;
revoke all on function public.angler_evidence_review(), angler_groups_private.review_next() from public,anon;
grant execute on function public.angler_evidence_review(), angler_groups_private.review_next() to authenticated;

create function public.angler_evidence_decide(owner_id uuid,catch_id uuid,outcome text,length_mm integer) returns jsonb
language sql security invoker set search_path='' as $$select angler_groups_private.decide_evidence($1,$2,$3,$4)$$;
revoke all on function public.angler_evidence_decide(uuid,uuid,text,integer), angler_groups_private.decide_evidence(uuid,uuid,text,integer) from public,anon;
grant execute on function public.angler_evidence_decide(uuid,uuid,text,integer), angler_groups_private.decide_evidence(uuid,uuid,text,integer) to authenticated;

create function public.angler_evidence_remove(catch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_groups_private.remove_evidence($1)$$;
revoke all on function public.angler_evidence_remove(uuid), angler_groups_private.remove_evidence(uuid) from public,anon;
grant execute on function public.angler_evidence_remove(uuid), angler_groups_private.remove_evidence(uuid) to authenticated;
