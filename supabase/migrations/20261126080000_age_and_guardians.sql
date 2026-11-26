-- Birth dates never leave the private account store. A missing date grants no rights.
alter table angler_private.profiles add column born_on date;
create function angler_private.age_years(born date) returns integer
language sql stable strict set search_path='' as $$
  select extract(year from age((statement_timestamp() at time zone 'Europe/Prague')::date,born))::int
$$;

create function public.angler_registration_profile() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.user_id,'name',p.display_name,
    'ageBand',case when p.born_on is null then 'unknown' when angler_private.age_years(p.born_on)<15 then 'child'
      when angler_private.age_years(p.born_on)<18 then 'teen' else 'adult' end,
    'current',p.born_on is not null and exists(select from angler_private.acceptances a
      where a.user_id=p.user_id and a.terms_revision='2026-11-26.2' and a.privacy_revision='2026-11-26.2'))
  from angler_private.profiles p where p.user_id=auth.uid() and coalesce(auth.jwt()->>'is_anonymous','false')='false'
$$;

-- Older APKs have unrestricted device sharing. Only age-eligible profiles can enter through their endpoint.
create or replace function public.angler_profile() returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p->>'ageBand'='child' then p || '{"current":false}'::jsonb else p end
  from public.angler_registration_profile() p
$$;

create function public.angler_register(nickname text, terms text, privacy text, birth_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); registered date;
begin
  if coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists
     (select from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if terms is distinct from '2026-11-26.2' or privacy is distinct from '2026-11-26.2' then
    raise exception 'Document revision mismatch' using errcode='22023';
  end if;
  select born_on into registered from angler_private.profiles where user_id=actor for update;
  if registered is null and (birth_date is null or not isfinite(birth_date) or
       birth_date>(statement_timestamp() at time zone 'Europe/Prague')::date or angler_private.age_years(birth_date)>125) then
    raise exception 'Invalid birth date' using errcode='AN002';
  end if;
  if not found then
    if nickname collate "C" ~ U&'[\00AD\200B-\200F\202A-\202E\2060-\2064\2066-\2069\FEFF]' then
      raise exception 'Invisible display-name characters' using errcode='AN001';
    end if;
    begin
      insert into angler_private.profiles(user_id,display_name,born_on) values(actor,btrim(nickname),birth_date)
        on conflict(user_id) do nothing;
    exception when unique_violation then raise exception 'Display name already used' using errcode='PT409'; end;
  end if;
  update angler_private.profiles set born_on=birth_date where user_id=actor and born_on is null;
  select born_on into strict registered from angler_private.profiles where user_id=actor;
  if birth_date is not null and registered<>birth_date then
    raise exception 'Birth date correction requires account support' using errcode='AN002';
  end if;
  insert into angler_private.acceptances(user_id,terms_revision,privacy_revision) values(actor,terms,privacy) on conflict do nothing;
  return public.angler_registration_profile();
end $$;
revoke all on function public.angler_accept(text,text,text) from public,anon,authenticated;
revoke all on function public.angler_register(text,text,text,date), public.angler_registration_profile() from public,anon;
grant execute on function public.angler_register(text,text,text,date),public.angler_registration_profile() to authenticated;

create function angler_private.verified_subject() returns uuid
language plpgsql stable set search_path='' as $$
begin
  if (public.angler_registration_profile()->>'current')::boolean is not true or
     not exists(select from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'Verified age and profile required' using errcode='42501';
  end if;
  return auth.uid();
end $$;

-- Every general community, marketplace and cloud journal operation uses this identity check.
create or replace function angler_groups_private.subject() returns uuid
language plpgsql stable set search_path='' as $$
declare actor uuid:=angler_private.verified_subject();
begin
  if (select angler_private.age_years(born_on) from angler_private.profiles where user_id=actor)<15 then
    raise exception 'Group permission required' using errcode='42501';
  end if;
  return actor;
end $$;

-- The pilot operator establishes this link after checking parental authority outside the child account.
-- Neither the child, a group owner, nor a client-accessible RPC can install a guardian.
create table angler_private.guardians (
  child uuid primary key references angler_private.profiles(user_id) on delete cascade,
  guardian uuid not null references angler_private.profiles(user_id) on delete cascade,
  verified_at timestamptz not null default now(),
  unique(child,guardian), check(child<>guardian)
);
create index guardians_by_parent on angler_private.guardians(guardian);
create table angler_private.group_permissions (
  child uuid not null, guardian uuid not null, group_id uuid not null,
  kind text not null check(kind in ('catch','tip')), granted_at timestamptz not null default now(),
  primary key(child,group_id,kind),
  foreign key(child,guardian) references angler_private.guardians(child,guardian) on delete cascade,
  foreign key(group_id,child) references angler_groups_private.members(group_id,user_id) on delete cascade
);
alter table angler_private.guardians enable row level security;
alter table angler_private.group_permissions enable row level security;
revoke all on angler_private.guardians,angler_private.group_permissions from public,anon,authenticated;

create function angler_private.group_subject(target uuid, feature text, writing boolean) returns uuid
language plpgsql set search_path='' as $$
declare actor uuid:=angler_private.verified_subject();
begin
  if (select angler_private.age_years(born_on) from angler_private.profiles where user_id=actor)<15 then
    if writing then
      perform from angler_private.group_permissions where child=actor and group_id=target and kind=feature for share;
    else
      perform from angler_private.group_permissions where child=actor and group_id=target and kind=feature;
    end if;
    if not found then raise exception 'Guardian permission required' using errcode='42501'; end if;
  end if;
  return actor;
end $$;

create function public.angler_family_permissions() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('child',c.user_id,'name',c.display_name,
    'group',g.id,'groupName',g.name,'catch',exists(select from angler_private.group_permissions
      where child=c.user_id and group_id=g.id and kind='catch'),'tip',exists(select from angler_private.group_permissions
      where child=c.user_id and group_id=g.id and kind='tip')) order by c.display_name,g.name,g.id),'[]'::jsonb))
  from angler_private.guardians l join angler_private.profiles c on c.user_id=l.child
    join angler_private.profiles a on a.user_id=l.guardian join angler_groups_private.members m on m.user_id=c.user_id
    join angler_groups_private.groups g on g.id=m.group_id
  where l.guardian=angler_private.verified_subject() and angler_private.age_years(a.born_on)>=18 and
      (angler_private.age_years(c.born_on)<15 or exists(select from angler_private.group_permissions
          where child=c.user_id and group_id=g.id))
$$;

create function public.angler_family_permission(child_id uuid,target uuid,feature text,allowed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.verified_subject();
begin
  if allowed is null or feature is null or feature not in ('catch','tip') or not exists
     (select from angler_private.profiles where user_id=actor and angler_private.age_years(born_on)>=18) then
    raise exception 'Verified guardian required' using errcode='42501';
  end if;
  perform from angler_private.guardians where child=child_id and guardian=actor for share;
  if not found then raise exception 'Verified guardian required' using errcode='42501'; end if;
  if allowed then
    perform from angler_groups_private.members where group_id=target and user_id=child_id for share;
    if not found or not exists(select from angler_private.profiles where user_id=child_id and angler_private.age_years(born_on)<15) then
      raise exception 'Child membership required' using errcode='42501';
    end if;
    insert into angler_private.group_permissions(child,guardian,group_id,kind) values(child_id,actor,target,feature) on conflict do nothing;
  else
    delete from angler_private.group_permissions where child=child_id and guardian=actor and group_id=target and kind=feature;
  end if;
  return '{}'::jsonb;
end $$;

-- Revocation applies to posts made under this permission, including after the child's 15th birthday.
alter table angler_weekly.entries add column parental_share boolean not null default false;
alter table angler_weekly.votes add column parental_share boolean not null default false;
alter table angler_groups_private.tips add column parental_share boolean not null default false;

-- A group catch does not have to qualify for a weekly competition or have a photo.
create table angler_groups_private.catch_posts (
  position bigint generated always as identity primary key,
  group_id uuid not null references angler_groups_private.groups(id) on delete cascade,
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check(member_id=author), request_id uuid not null,
  caught date not null, species text not null check(length(species) between 1 and 100 and species ~ '[^[:space:]]'),
  length_mm integer check(length_mm between 1 and 30000), photo bytea check(angler_weekly.webp(photo)),
  parental_share boolean not null,
  unique(author,request_id),
  foreign key(group_id,member_id) references angler_groups_private.members(group_id,user_id) on delete cascade
);
create index catch_posts_group on angler_groups_private.catch_posts(group_id,position desc);
create index catch_posts_member on angler_groups_private.catch_posts(group_id,member_id);
alter table angler_groups_private.catch_posts enable row level security;
revoke all on angler_groups_private.catch_posts from public,anon,authenticated;
create trigger limit_group_catches after insert on angler_groups_private.catch_posts
  for each row execute function angler_private.limit_write('cards','25');

create function angler_private.withdraw_child_shares() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.kind='tip' then
    delete from angler_groups_private.tips where group_id=old.group_id and author_id=old.child and parental_share;
  else
    delete from angler_groups_private.catch_posts where group_id=old.group_id and author=old.child and parental_share;
    delete from angler_weekly.votes where group_id=old.group_id and voter=old.child and parental_share;
    delete from angler_weekly.entries where group_id=old.group_id and author=old.child and parental_share;
  end if;
  return old;
end $$;
create trigger withdraw_child_shares after delete on angler_private.group_permissions
  for each row execute function angler_private.withdraw_child_shares();

revoke all on function angler_private.age_years(date),angler_private.verified_subject(),angler_private.group_subject(uuid,text,boolean),
  angler_private.withdraw_child_shares(), public.angler_family_permissions(),public.angler_family_permission(uuid,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.angler_family_permissions(),public.angler_family_permission(uuid,uuid,text,boolean) to authenticated;

create or replace function angler_groups_private.list_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject(); restricted boolean := (public.angler_registration_profile()->>'ageBand')='child';
begin
  return jsonb_build_object('ageBand',public.angler_registration_profile()->>'ageBand','groups', coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'owner',g.owner_id=actor,
                         'canShareCatch',not restricted or exists(select from angler_private.group_permissions where child=actor and group_id=g.id and kind='catch'),
                         'canShareTip',not restricted or exists(select from angler_private.group_permissions where child=actor and group_id=g.id and kind='tip'),
                         'memberCount',1+(select count(*) from angler_groups_private.members c where c.group_id=g.id))
                     order by g.name,g.id)
    from angler_groups_private.groups g
    where g.owner_id=actor or exists (select from angler_groups_private.members m
                                      where m.group_id=g.id and m.user_id=actor)
  ), '[]'::jsonb));
end;
$$;

create or replace function angler_groups_private.join_group(invite_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject(); fingerprint bytea := sha256(uuid_send(invite_code));
        target angler_groups_private.groups;
begin
  select * into target from angler_groups_private.groups g where g.invite_hash=fingerprint for update;
  if not found or target.invite_expires_at <= clock_timestamp() then
    if exists (select from angler_groups_private.members m where m.user_id=actor and m.joined_with=fingerprint) then
      return '{}'::jsonb;
    end if;
    raise exception 'Invitation unavailable' using errcode='22023';
  end if;
  if target.owner_id <> actor then
    insert into angler_groups_private.members(group_id,user_id,joined_with) values(target.id,actor,fingerprint)
      on conflict do nothing;
    if found then
      update angler_groups_private.groups set invite_hash=null, invite_expires_at=null where id=target.id;
    end if;
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function angler_groups_private.leave_group(group_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject();
begin
  delete from angler_groups_private.members m where m.group_id=$1 and m.user_id=actor;
  return '{}'::jsonb;
end;
$$;

create or replace function angler_groups_private.create_group(group_id uuid, group_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject();
begin
  if not exists(select from angler_private.profiles where user_id=actor and angler_private.age_years(born_on)>=18) then
    raise exception 'Group founders must be 18 or older' using errcode='42501';
  end if;
  insert into angler_groups_private.groups(id,owner_id,name) values(group_id,actor,btrim(group_name))
    on conflict(id) do nothing;
  if not exists (select from angler_groups_private.groups g
                 where g.id=group_id and g.owner_id=actor and g.name=btrim(group_name)) then
    raise exception 'Cannot create group' using errcode='22023';
  end if;
  return jsonb_build_object('id',group_id);
end;
$$;

create or replace function angler_groups_private.post_tip(target uuid, request uuid, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.group_subject(target,'tip',true);
        is_owner boolean := angler_groups_private.require_group_access(target, actor);
begin
  if request is null or message is null or char_length(message) not between 1 and 4096
    or message !~ '[^[:space:]]' then
    raise exception 'Invalid tip' using errcode='22023';
  end if;
  insert into angler_groups_private.tips(group_id, author_id, member_id, request_id, body, parental_share)
    values(target, actor, case when not is_owner then actor end, request, message, public.angler_registration_profile()->>'ageBand'='child')
    on conflict (author_id, request_id) do nothing;
  if not found and not exists (
    select from angler_groups_private.tips t where t.author_id=actor and t.request_id=request
      and t.group_id=target and t.body=message
  ) then raise exception 'Request already used' using errcode='PT409'; end if;
  return jsonb_build_object('id',request);
exception when foreign_key_violation then
  raise exception 'Group unavailable' using errcode='42501';
end;
$$;

create or replace function angler_groups_private.list_tips(target uuid, older_than bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform angler_groups_private.require_group_access(target, angler_private.group_subject(target,'tip',false));
  return (
    with batch as (
      select t.position, t.body, t.posted_at, p.display_name
      from angler_groups_private.tips t join angler_private.profiles p on p.user_id=t.author_id
      where t.group_id=target and (older_than is null or t.position < older_than)
      order by t.position desc limit 21
    ), page as (select * from batch order by position desc limit 20)
    select jsonb_build_object('tips', coalesce(jsonb_agg(jsonb_build_object(
      'author',display_name,'text',body,'postedAt',floor(extract(epoch from posted_at)*1000)::bigint
    ) order by position desc), '[]'::jsonb),
      'next', case when (select count(*) from batch)>20 then min(position)::text end)
    from page
  );
end;
$$;

create or replace function angler_weekly.enter(target uuid,request uuid,source_id uuid,day date,label text,image text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',true); owner boolean:=angler_groups_private.require_group_access(target,actor);
  today date:=(statement_timestamp() at time zone 'Europe/Prague')::date; pixels bytea; existing angler_weekly.entries;
begin
  if request is null or source_id is null or day is null or not isfinite(day) or label is null or
    length(label) not between 1 and 100 or label !~ '[^[:space:]]' or image is null or length(image)>65536
    then raise exception 'Invalid catch card' using errcode='22023'; end if;
  pixels:=decode(image,'base64');
  if not angler_weekly.webp(pixels) then raise exception 'Invalid photo' using errcode='22023'; end if;
  if day between angler_weekly.monday(today) and today then
    insert into angler_weekly.entries(id,group_id,author,member_id,catch_id,caught,species,photo,parental_share)
      values(request,target,actor,case when not owner then actor end,source_id,day,label,pixels,public.angler_registration_profile()->>'ageBand'='child')
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

create or replace function angler_weekly.board(target uuid,requested date,start_at integer,expected text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',false); today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
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

create or replace function angler_weekly.vote(target uuid,entry uuid,selected boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',true); owner boolean:=angler_groups_private.require_group_access(target,actor);
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
    insert into angler_weekly.votes(group_id,entry_id,voter,member_id,parental_share)
      values(target,entry,actor,case when not owner then actor end,public.angler_registration_profile()->>'ageBand'='child') on conflict do nothing;
  else delete from angler_weekly.votes where entry_id=entry and voter=actor;
  end if;
  return '{}'::jsonb;
exception when foreign_key_violation then raise exception 'Group unavailable' using errcode='42501';
end$$;

create or replace function angler_weekly.report(target uuid,entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',true); owner boolean:=angler_groups_private.require_group_access(target,actor);
begin
  perform from angler_weekly.entries e where e.id=entry and e.group_id=target and e.photo is not null
    and not e.held and e.author<>actor for share;
  if not found then raise exception 'Entry unavailable' using errcode='PT404'; end if;
  insert into angler_weekly.reports(group_id,entry_id,reporter,member_id)
    values(target,entry,actor,case when not owner then actor end) on conflict do nothing;
  return '{}'::jsonb;
end$$;

create or replace function angler_weekly.withdraw(target uuid,entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',true);
begin
  perform angler_groups_private.require_group_access(target,actor);
  return angler_weekly.remove_entry(target,entry,actor);
end$$;

-- A licence edit cannot change the registered age. Keep the old wire shape for installed clients.
alter function angler_groups_private.my_details(jsonb) rename to licence_details;
revoke all on function angler_groups_private.licence_details(jsonb) from public,anon,authenticated;
create function angler_groups_private.my_details(changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); years integer; result jsonb;
begin
  select angler_private.age_years(born_on) into strict years from angler_private.profiles where user_id=actor;
  result:=angler_groups_private.licence_details(case when changes is null then null else changes || '{"age":null}'::jsonb end);
  return result || jsonb_build_object('age',years);
end $$;
create or replace function public.angler_my_details(changes jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$ select angler_groups_private.my_details(changes) $$;
revoke all on function angler_groups_private.my_details(jsonb) from public,anon;
grant execute on function angler_groups_private.my_details(jsonb) to authenticated;

create or replace function angler_commerce.credit_receipt(actor uuid, h text, fund angler_commerce.lots, args jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare qty integer;
begin
   if (select mode from angler_commerce.settings) is distinct from args->>'mode' or args->>'mode' not in ('live','test')
      or args->>'order' is null or length(args->>'order')=0 then raise exception 'Incorrect payment environment'; end if;
   qty:=case args->>'sku' when 'credits_50_czk' then 50 when 'credits_100_czk' then 100 end;
   if qty is null or actor is null or not exists(select from angler_private.profiles where user_id=actor) then raise exception 'Invalid purchase'; end if;
   if fund.id is null and not exists(select from angler_private.profiles
       where user_id=actor and angler_private.age_years(born_on)>=15) then
    raise exception 'Purchase unavailable for this account' using errcode='42501';
  end if;
  if fund.id is null then
     insert into angler_commerce.lots(holder,source,units,token_hash,order_ref)
       values(actor,'google',qty,h,args->>'order');
   elsif fund.holder is distinct from (args->>'holder')::uuid or fund.units<>qty or fund.order_ref is distinct from args->>'order' then
     raise exception 'Receipt mismatch';
   end if;
end $$;

create or replace function angler_messages.peer(actor uuid, conversation uuid, topic uuid) returns uuid
language plpgsql stable set search_path='' as $$
declare other_user uuid;
begin
  if num_nonnulls(conversation,topic) <> 1 then
    raise exception 'Choose one destination' using errcode='22023';
  end if;
  if conversation is not null then
    select case when actor=t.first_user then t.second_user else t.first_user end into other_user
      from angler_messages.threads t where t.id=conversation and actor in (t.first_user,t.second_user);
  else
    select p.author_id into other_user from angler_discussions.posts p
      where p.id=topic and p.parent is null and p.body is not null and p.author_id<>actor;
  end if;
  if not exists(select from angler_private.profiles where user_id=other_user and angler_private.age_years(born_on)>=15) then raise exception 'Destination unavailable' using errcode='PT404'; end if;
  return other_user;
end$$;

create function public.angler_group_catch_post(group_id uuid,request_id uuid,day date,species text,length_mm integer,photo text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(group_id,'catch',true);
  is_owner boolean:=angler_groups_private.require_group_access(group_id,actor); pixels bytea;
begin
  if day is null or not isfinite(day) or day>(now() at time zone 'Europe/Prague')::date or length(photo)>65536 then
    raise exception 'Invalid catch' using errcode='22023';
  end if;
  pixels:=decode(photo,'base64');
  insert into angler_groups_private.catch_posts as p(group_id,author,member_id,request_id,caught,species,length_mm,photo,parental_share)
    values($1,actor,case when not is_owner then actor end,$2,$3,$4,$5,pixels,public.angler_registration_profile()->>'ageBand'='child')
    on conflict on constraint catch_posts_author_request_id_key do nothing;
  if not found and not exists(select from angler_groups_private.catch_posts p where p.author=actor and p.request_id=$2
    and p.group_id=$1 and p.caught=$3 and p.species=$4 and p.length_mm is not distinct from $5 and p.photo is not distinct from pixels) then
    raise exception 'Changed catch request' using errcode='PT409';
  end if;
  return jsonb_build_object('id',$2);
end $$;

create function public.angler_group_catches(group_id uuid,before_position bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform angler_groups_private.require_group_access($1,angler_private.group_subject($1,'catch',false));
  return (with batch as (select p.position,p.caught,p.species,p.length_mm,p.photo,a.display_name
    from angler_groups_private.catch_posts p join angler_private.profiles a on a.user_id=p.author
    where p.group_id=$1 and ($2 is null or p.position<$2) order by p.position desc limit 3),
    page as (select * from batch order by position desc limit 2)
    select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('author',display_name,'day',caught,
      'species',species,'mm',length_mm,'photo',replace(encode(photo,'base64'),chr(10),'')) order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>2 then min(position)::text end) from page);
end $$;
revoke all on function public.angler_group_catch_post(uuid,uuid,date,text,integer,text),public.angler_group_catches(uuid,bigint) from public,anon;
grant execute on function public.angler_group_catch_post(uuid,uuid,date,text,integer,text),public.angler_group_catches(uuid,bigint) to authenticated;
