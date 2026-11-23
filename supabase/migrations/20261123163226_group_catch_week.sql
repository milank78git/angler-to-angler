create schema angler_weekly;
revoke all on schema angler_weekly from public,anon,authenticated;
grant usage on schema angler_weekly to authenticated;

create table angler_weekly.entries (
  id uuid primary key, group_id uuid not null references angler_groups_private.groups(id) on delete cascade,
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check (member_id=author),
  foreign key(group_id,member_id) references angler_groups_private.members(group_id,user_id) on delete cascade,
  catch_id uuid not null, caught date not null,
  week_start date generated always as (caught-(extract(isodow from caught)::int-1)) stored,
  species text, photo bytea, held boolean not null default false,
  check ((species is null)=(photo is null)),
  check (species ~ '[^[:space:]]' and length(species) between 1 and 100),
  unique(group_id,id)
);
create unique index weekly_active_catch on angler_weekly.entries(group_id,author,catch_id) where photo is not null;
create index weekly_by_week on angler_weekly.entries(group_id,week_start,id) where photo is not null;
create index weekly_membership on angler_weekly.entries(group_id,member_id);
create index weekly_author on angler_weekly.entries(author);

create table angler_weekly.votes (
  group_id uuid not null, entry_id uuid not null, voter uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check (member_id=voter),
  foreign key(group_id,entry_id) references angler_weekly.entries(group_id,id) on delete cascade,
  foreign key(group_id,member_id) references angler_groups_private.members(group_id,user_id) on delete cascade,
  primary key(entry_id,voter)
);
create index weekly_voters on angler_weekly.votes(voter);
create index weekly_voter_membership on angler_weekly.votes(group_id,member_id);
create table angler_weekly.reports (
  group_id uuid not null, entry_id uuid not null, reporter uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check (member_id=reporter), reported_at timestamptz not null default now(),
  foreign key(group_id,entry_id) references angler_weekly.entries(group_id,id) on delete cascade,
  foreign key(group_id,member_id) references angler_groups_private.members(group_id,user_id) on delete cascade,
  primary key(entry_id,reporter)
);
create index weekly_reporter on angler_weekly.reports(reporter);
create index weekly_report_membership on angler_weekly.reports(group_id,member_id);
alter table angler_weekly.reports enable row level security;
alter table angler_weekly.entries enable row level security;
alter table angler_weekly.votes enable row level security;
revoke all on all tables in schema angler_weekly from public,anon,authenticated;

create function angler_weekly.monday(d date) returns date language sql immutable strict set search_path='' as $$
  select d-(extract(isodow from d)::int-1)
$$;
-- Only a single lossy VP8 image chunk is accepted. EXIF, XMP, ICC, animation and appended chunks
-- have no place in the published container. Dimensions and payload size are bounded independently.
create function angler_weekly.webp(p bytea) returns boolean language plpgsql immutable strict set search_path='' as $$
declare n int:=octet_length(p); chunk bigint; riff bigint; w int; h int;
begin
  if n not between 32 and 49152 then return false; end if;
  if substring(p from 1 for 4)<>decode('52494646','hex') or
     substring(p from 9 for 8)<>decode('5745425056503820','hex') or
     (get_byte(p,20)&1)<>0 or substring(p from 24 for 3)<>decode('9d012a','hex') then return false; end if;
  riff:=get_byte(p,4)+(get_byte(p,5)<<8)+(get_byte(p,6)<<16)+(get_byte(p,7)::bigint<<24);
  chunk:=get_byte(p,16)+(get_byte(p,17)<<8)+(get_byte(p,18)<<16)+(get_byte(p,19)::bigint<<24);
  w:=(get_byte(p,26)+(get_byte(p,27)<<8))&16383; h:=(get_byte(p,28)+(get_byte(p,29)<<8))&16383;
  return riff=n-8 and chunk>=10 and 20+chunk+(chunk%2)=n and
    (chunk%2=0 or get_byte(p,n-1)=0) and w between 1 and 640 and h between 1 and 640;
end$$;

create function angler_weekly.enter(target uuid,request uuid,source_id uuid,day date,label text,image text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); owner boolean:=angler_groups_private.require_group_access(target,actor);
  today date:=(statement_timestamp() at time zone 'Europe/Prague')::date; pixels bytea; existing angler_weekly.entries;
begin
  if request is null or source_id is null or day is null or not isfinite(day) or label is null or
    length(label) not between 1 and 100 or label !~ '[^[:space:]]' or image is null or length(image)>65536
    then raise exception 'Invalid catch card' using errcode='22023'; end if;
  pixels:=decode(image,'base64');
  if not angler_weekly.webp(pixels) then raise exception 'Invalid photo' using errcode='22023'; end if;
  if day between angler_weekly.monday(today) and today then
    insert into angler_weekly.entries(id,group_id,author,member_id,catch_id,caught,species,photo)
      values(request,target,actor,case when not owner then actor end,source_id,day,label,pixels)
      on conflict do nothing;
  end if;
  select e.* into existing from angler_weekly.entries e where e.id=request and e.author=actor and e.group_id=target;
  if found and existing.catch_id=source_id and existing.caught=day and existing.species=label and existing.photo=pixels then
    return jsonb_build_object('id',request,'week',existing.week_start);
  end if;
  if day not between angler_weekly.monday(today) and today then raise exception 'Catch outside current week' using errcode='PT422'; end if;
  raise exception 'Catch already entered or request changed' using errcode='PT409';
exception when foreign_key_violation then raise exception 'Group unavailable' using errcode='42501';
end$$;

create function angler_weekly.vote(target uuid,entry uuid,selected boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); owner boolean:=angler_groups_private.require_group_access(target,actor);
  fish angler_weekly.entries;
begin
  select e.* into fish from angler_weekly.entries e where e.id=entry and e.group_id=target and e.photo is not null for update;
  if not found then raise exception 'Entry unavailable' using errcode='PT404'; end if;
  if fish.author=actor then raise exception 'Cannot vote for own catch' using errcode='42501'; end if;
  if selected is null then raise exception 'Missing vote' using errcode='22023'; end if;
  if selected then
    if fish.held then raise exception 'Entry unavailable' using errcode='PT404'; end if;
    if fish.week_start<>angler_weekly.monday((statement_timestamp() at time zone 'Europe/Prague')::date) then
      if exists(select from angler_weekly.votes where entry_id=entry and voter=actor) then return '{}'::jsonb; end if;
      raise exception 'Voting is closed' using errcode='PT422';
    end if;
    insert into angler_weekly.votes values(target,entry,actor,case when not owner then actor end) on conflict do nothing;
  else delete from angler_weekly.votes where entry_id=entry and voter=actor;
  end if;
  return '{}'::jsonb;
exception when foreign_key_violation then raise exception 'Group unavailable' using errcode='42501';
end$$;

-- Keep a receipt after withdrawal so replaying an old publish cannot restore the photo.
create function angler_weekly.remove_entry(target uuid,entry uuid,author_filter uuid) returns jsonb
language plpgsql set search_path='' as $$
begin
  update angler_weekly.entries set photo=null,species=null where group_id=target and id=entry
    and (author_filter is null or author=author_filter);
  if not found then raise exception 'Entry unavailable' using errcode='PT404'; end if;
  delete from angler_weekly.votes where entry_id=entry;
  delete from angler_weekly.reports where entry_id=entry;
  return '{}'::jsonb;
end$$;
create function angler_weekly.report(target uuid,entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); owner boolean:=angler_groups_private.require_group_access(target,actor);
begin
  perform from angler_weekly.entries e where e.id=entry and e.group_id=target and e.photo is not null
    and not e.held and e.author<>actor for share;
  if not found then raise exception 'Entry unavailable' using errcode='PT404'; end if;
  insert into angler_weekly.reports(group_id,entry_id,reporter,member_id)
    values(target,entry,actor,case when not owner then actor end) on conflict do nothing;
  return '{}'::jsonb;
end$$;
create function angler_weekly.withdraw(target uuid,entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  perform angler_groups_private.require_group_access(target,actor);
  return angler_weekly.remove_entry(target,entry,actor);
end$$;

-- Compute ranks across the whole round. The revision prevents skipped/duplicate cards
-- when a vote, withdrawal or departure changes their order between page requests.
create function angler_weekly.board(target uuid,requested date,start_at integer,expected text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
  current_week date:=angler_weekly.monday(today); week date:=coalesce(requested,current_week); result jsonb;
begin
  perform angler_groups_private.require_group_access(target,actor);
  if not isfinite(week) or week<>angler_weekly.monday(week) or week>current_week or start_at is null or start_at<0
    or (start_at>0 and expected is null) then raise exception 'Invalid round or page' using errcode='22023'; end if;
  with scores as (
    select e.id,e.held,count(v.voter) as score,coalesce(bool_or(v.voter=actor),false) as voted
      from angler_weekly.entries e left join angler_weekly.votes v on v.entry_id=e.id
      where e.group_id=target and e.week_start=week and e.photo is not null and (not e.held or e.author=actor) group by e.id
  ), ranked as (
    select s.*,case when not held then rank() over(partition by held order by score desc) end as place from scores s
  ), page as (
    select * from ranked order by held,score desc,id offset start_at limit 3
  )
  select jsonb_build_object('week',week,'today',today,'open',week=current_week,
    'previous',(select max(e.week_start) from angler_weekly.entries e where e.group_id=target and e.week_start<week and e.photo is not null and (not e.held or e.author=actor)),
    'following',case when week<current_week then coalesce((select min(e.week_start) from angler_weekly.entries e
      where e.group_id=target and e.week_start>week and e.photo is not null and (not e.held or e.author=actor)),current_week) end,
    'version',(select md5(coalesce(string_agg(id::text||':'||score::text||':'||held::text,',' order by id),'')) from scores),
    'next',case when (select count(*) from scores)>start_at::bigint+3 then start_at+3 end,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'author',p.display_name,'mine',e.author=actor,
      'species',e.species,'day',e.caught,'photo',replace(encode(e.photo,'base64'),chr(10),''),
      'score',s.score,'voted',s.voted,'place',s.place,'held',s.held,
      'reported',exists(select from angler_weekly.reports r where r.entry_id=e.id and r.reporter=actor)) order by s.held,s.score desc,s.id)
      from page s join angler_weekly.entries e on s.id=e.id join angler_private.profiles p on p.user_id=e.author),'[]'::jsonb))
    into result;
  if start_at>0 and result->>'version' is distinct from expected then raise exception 'Ranking changed' using errcode='PT409'; end if;
  return result;
end$$;

create function public.angler_weekly_enter(group_id uuid,request_id uuid,catch_id uuid,catch_day date,species text,photo text) returns jsonb
language sql security invoker set search_path='' as $$select angler_weekly.enter($1,$2,$3,$4,$5,$6)$$;
create function public.angler_weekly_board(group_id uuid,week_start date default null,page_offset integer default 0,expected_version text default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_weekly.board($1,$2,$3,$4)$$;
create function public.angler_weekly_vote(group_id uuid,entry_id uuid,selected boolean) returns jsonb
language sql security invoker set search_path='' as $$select angler_weekly.vote($1,$2,$3)$$;
create function public.angler_weekly_report(group_id uuid,entry_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_weekly.report($1,$2)$$;
create function public.angler_weekly_withdraw(group_id uuid,entry_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_weekly.withdraw($1,$2)$$;
revoke all on all functions in schema angler_weekly from public,anon,authenticated;
grant execute on function angler_weekly.enter(uuid,uuid,uuid,date,text,text),angler_weekly.board(uuid,date,integer,text),
 angler_weekly.vote(uuid,uuid,boolean),angler_weekly.report(uuid,uuid),angler_weekly.withdraw(uuid,uuid) to authenticated;
revoke all on function public.angler_weekly_enter(uuid,uuid,uuid,date,text,text),public.angler_weekly_board(uuid,date,integer,text),
 public.angler_weekly_vote(uuid,uuid,boolean),public.angler_weekly_report(uuid,uuid),public.angler_weekly_withdraw(uuid,uuid) from public,anon,authenticated;
grant execute on function public.angler_weekly_enter(uuid,uuid,uuid,date,text,text),public.angler_weekly_board(uuid,date,integer,text),
 public.angler_weekly_vote(uuid,uuid,boolean),public.angler_weekly_report(uuid,uuid),public.angler_weekly_withdraw(uuid,uuid) to authenticated;
