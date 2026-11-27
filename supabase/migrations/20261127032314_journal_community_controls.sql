-- Only visible replies keep a discussion open.
create or replace function angler_discussions.has_replies(post uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select from angler_discussions.posts where (parent=post or reply_to=post) and body is not null)
$$;

-- Withdrawing a tip retains its request ID to prevent delayed retries from publishing it again.
alter table angler_groups_private.tips alter column body drop not null;
create table angler_groups_private.tip_flags (
  post_position bigint primary key references angler_groups_private.tips(position) on delete cascade,
  reported_at timestamptz not null default now()
);
alter table angler_groups_private.tip_flags enable row level security;
revoke all on angler_groups_private.tip_flags from public,anon,authenticated;
create trigger limit_tip_flags after insert on angler_groups_private.tip_flags
  for each row execute function angler_private.limit_write('reports','20');

create or replace function angler_groups_private.list_tips(target uuid, older_than bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=angler_private.group_subject(target,'tip',false);
  owner boolean:=angler_groups_private.require_group_access(target,actor);
begin
  return (
    with batch as (
      select t.position, t.author_id, t.body, t.posted_at, p.display_name
      from angler_groups_private.tips t join angler_private.profiles p on p.user_id=t.author_id
      where t.group_id=target and t.body is not null and (older_than is null or t.position < older_than)
      order by t.position desc limit 21
    ), page as (select * from batch order by position desc limit 20)
    select jsonb_build_object('tips', coalesce(jsonb_agg(jsonb_build_object(
      'position',position::text,'mine',author_id=actor,'canRemove',owner or author_id=actor,
      'author',display_name,'text',body,'postedAt',floor(extract(epoch from posted_at)*1000)::bigint
    ) order by position desc), '[]'::jsonb),
      'next', case when (select count(*) from batch)>20 then min(position)::text end)
    from page
  );
end;
$$;

create function public.angler_group_tip_change(group_id uuid, post_position bigint, action text,
  message text default null, previous text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject($1,'tip',true);
  owner boolean:=angler_groups_private.require_group_access($1,actor);
  tip angler_groups_private.tips;
begin
  select * into tip from angler_groups_private.tips t where t.group_id=$1 and t.position=$2 for update;
  if not found then raise exception 'Tip unavailable' using errcode='PT404'; end if;
  if action='remove' and (owner or tip.author_id=actor) then
    update angler_groups_private.tips set body=null where position=$2;
    delete from angler_groups_private.tip_flags where tip_flags.post_position=$2;
  elsif action='edit' and tip.author_id=actor and tip.body is not null then
    if message is null or char_length(message) not between 1 and 4096 or message !~ '[^[:space:]]' then
      raise exception 'Invalid tip' using errcode='22023';
    end if;
    if tip.body is distinct from previous and tip.body<>message then raise exception 'Tip changed' using errcode='PT409'; end if;
    update angler_groups_private.tips set body=message where position=$2;
  elsif action='report' and tip.author_id<>actor and tip.body is not null then
    insert into angler_groups_private.tip_flags(post_position) values($2) on conflict do nothing;
  else raise exception 'Tip unavailable' using errcode='PT404';
  end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.angler_group_tip_change(uuid,bigint,text,text,text) from public,anon;
grant execute on function public.angler_group_tip_change(uuid,bigint,text,text,text) to authenticated;

create or replace function angler_weekly.board(target uuid,requested date,start_at integer,expected text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',false); today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
  current_week date:=angler_weekly.monday(today); week date:=coalesce(requested,current_week); result jsonb;
  owner boolean:=angler_groups_private.require_group_access(target,actor);
begin
  if not isfinite(week) or week<>angler_weekly.monday(week) or week>current_week or start_at is null or start_at<0
    or (start_at>0 and expected is null) then raise exception 'Invalid round or page' using errcode='22023'; end if;
  with scores as (
    select e.id,e.held,count(v.voter) as score,coalesce(bool_or(v.voter=actor),false) as voted
      from angler_weekly.entries e left join angler_weekly.votes v on v.entry_id=e.id
      where e.group_id=target and e.week_start=week and e.photo is not null and (not e.held or e.author=actor or owner) group by e.id
  ), ranked as (
    select s.*,case when not held then rank() over(partition by held order by score desc) end as place from scores s
  ), page as (
    select * from ranked order by held,score desc,id offset start_at limit 3
  )
  select jsonb_build_object('week',week,'today',today,'open',week=current_week,
    'previous',(select max(e.week_start) from angler_weekly.entries e where e.group_id=target and e.week_start<week and e.photo is not null and (not e.held or e.author=actor or owner)),
    'following',case when week<current_week then coalesce((select min(e.week_start) from angler_weekly.entries e
      where e.group_id=target and e.week_start>week and e.photo is not null and (not e.held or e.author=actor or owner)),current_week) end,
    'version',(select md5(coalesce(string_agg(id::text||':'||score::text||':'||held::text,',' order by id),'')) from scores),
    'next',case when (select count(*) from scores)>start_at::bigint+3 then start_at+3 end,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'author',p.display_name,'mine',e.author=actor,'canRemove',owner or e.author=actor,
      'species',e.species,'day',e.caught,'photo',replace(encode(e.photo,'base64'),chr(10),''),
      'score',s.score,'voted',s.voted,'place',s.place,'held',s.held,
      'reported',exists(select from angler_weekly.reports r where r.entry_id=e.id and r.reporter=actor)) order by s.held,s.score desc,s.id)
      from page s join angler_weekly.entries e on s.id=e.id join angler_private.profiles p on p.user_id=e.author),'[]'::jsonb))
    into result;
  if start_at>0 and result->>'version' is distinct from expected then raise exception 'Ranking changed' using errcode='PT409'; end if;
  return result;
end$$;

create or replace function angler_weekly.withdraw(target uuid,entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject(target,'catch',true);
begin
  return angler_weekly.remove_entry(target,entry,
    case when not angler_groups_private.require_group_access(target,actor) then actor end);
end$$;

-- A point is owned only when its original contributor is known.
create function public.angler_parking_remove(water_key text, point_id uuid, expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); current_revision integer;
begin
  select revision into current_revision from angler_activity.parking_points
    where id=$2 and water=$1 and creator=actor for update;
  if not found then raise exception 'Point unavailable' using errcode='PT404'; end if;
  if current_revision is distinct from $3 then raise exception 'Point changed' using errcode='PT409'; end if;
  delete from angler_activity.parking_points where id=$2;
  return '{}'::jsonb;
end $$;
revoke all on function public.angler_parking_remove(text,uuid,integer) from public,anon;
grant execute on function public.angler_parking_remove(text,uuid,integer) to authenticated;

-- New group links remain valid independently until expiry. Already-issued single-use codes keep their contract.
create table angler_groups_private.invitations (
  digest bytea primary key, group_id uuid not null references angler_groups_private.groups on delete cascade,
  expires_at timestamptz not null
);
alter table angler_groups_private.invitations enable row level security;
revoke all on angler_groups_private.invitations from public,anon,authenticated;
create trigger limit_group_links after insert on angler_groups_private.invitations
  for each row execute function angler_private.limit_write('invites','40');
create index group_invitation_expiry on angler_groups_private.invitations(expires_at);
create function public.angler_group_link(group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); code uuid:=gen_random_uuid();
  expiry timestamptz:=clock_timestamp()+interval '24 hours';
begin
  perform from angler_groups_private.groups g where g.id=$1 and g.owner_id=actor for share;
  if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
  delete from angler_groups_private.invitations where expires_at<=now();
  insert into angler_groups_private.invitations values(sha256(uuid_send(code)),$1,expiry);
  return jsonb_build_object('code',code,'expiresAt',expiry);
end $$;
revoke all on function public.angler_group_link(uuid) from public,anon;
grant execute on function public.angler_group_link(uuid) to authenticated;
create or replace function angler_groups_private.join_group(invite_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_private.verified_subject(); fingerprint bytea := sha256(uuid_send(invite_code));
        target angler_groups_private.groups;
begin
  select g.* into target from angler_groups_private.groups g join angler_groups_private.invitations i
    on g.id=i.group_id where i.digest=fingerprint and i.expires_at>clock_timestamp() for share of g,i;
  if found then
    if target.owner_id<>actor then
      insert into angler_groups_private.members(group_id,user_id,joined_with) values(target.id,actor,fingerprint)
        on conflict do nothing;
    end if;
    return '{}'::jsonb;
  end if;
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

-- A deleted backup cannot be recreated by a previously enabled offline device.
alter table angler_sync.accounts add column erased boolean not null default false, add column epoch uuid;
create or replace function angler_sync.journal(op text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := angler_groups_private.subject();
  h text := args->>'hash';
  account angler_sync.accounts;
begin
  if op in ('erase','enable','put','save') then
    perform pg_advisory_xact_lock(hashtextextended(actor::text,13));
  end if;
  select * into account from angler_sync.accounts where owner=actor;
  if op='settings' then
    return jsonb_build_object('enabled',account.owner is not null and not account.erased,'epoch',account.epoch);
  elsif op='erase' then
    if account.erased then return jsonb_build_object('erased',true); end if;
    if account.epoch is distinct from (args->>'epoch')::uuid then raise exception 'Copy changed' using errcode='PT409'; end if;
    delete from angler_sync.documents where owner=actor;
    delete from angler_sync.chunks where owner=actor;
    delete from angler_sync.usage where owner=actor;
    insert into angler_sync.accounts(owner,erased,epoch) values(actor,true,gen_random_uuid())
      on conflict(owner) do update set erased=true,epoch=excluded.epoch;
    return jsonb_build_object('erased',true);
  end if;
  if account.epoch is distinct from (args->>'epoch')::uuid
    or (account.erased and (op<>'enable' or (args->>'consent') is distinct from 'true')) then
    raise exception 'Cloud copy was erased' using errcode='PT410';
  end if;
  if op='enable' then
    insert into angler_sync.accounts(owner) values(actor) on conflict(owner) do update set erased=false;
    return jsonb_build_object('enabled',true);
  elsif op='list' then
    return angler_sync.list_documents(actor,args) || jsonb_build_object(
      'floor',coalesce((select deletion_floor from angler_sync.accounts where owner=actor),0));
  elsif op='missing' then return angler_sync.missing_chunks(actor,args);
  elsif op='get' then
    return angler_sync.read_chunk(actor,h);
  end if;
  case op
    when 'put' then return angler_sync.put_chunk(actor,args);
    when 'save' then return angler_sync.save_document(actor,args);
    else raise exception 'Unknown journal operation' using errcode='PT422';
  end case;
end $$;

-- A receipt acknowledges only messages the client actually displayed.
alter table angler_messages.threads add column first_read bigint not null default 0,
  add column second_read bigint not null default 0;
create index incoming_message_receipt on angler_messages.entries(thread,from_first,position desc);
create or replace function angler_messages.inbox(cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return (with candidates as (
    select t.id,t.latest,a.display_name,e.posted_at,
      exists(select from angler_messages.entries incoming where incoming.thread=t.id
        and incoming.from_first<>(t.first_user=actor)
        and incoming.position>case when t.first_user=actor then t.first_read else t.second_read end) as unread
      from angler_messages.threads t join angler_messages.entries e on e.position=t.latest
      join angler_private.profiles a on a.user_id=case when t.first_user=actor then t.second_user else t.first_user end
      where actor in (t.first_user,t.second_user) and angler_private.age_years(a.born_on)>=15 and (cursor_pos is null or t.latest<cursor_pos)
      order by t.latest desc limit 21
  ), page as (select * from candidates order by latest desc limit 20)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('threadId',id,'peerName',display_name,
    'postedAt',posted_at,'unread',unread) order by latest desc),'[]'::jsonb),
    'next',case when (select count(*) from candidates)>20 then min(latest)::text end) from page);
end$$;

create function public.angler_message_read(thread_id uuid, through_position bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  update angler_messages.threads t set
    first_read=case when t.first_user=actor then greatest(t.first_read,$2) else t.first_read end,
    second_read=case when t.second_user=actor then greatest(t.second_read,$2) else t.second_read end
    where t.id=$1 and actor in (t.first_user,t.second_user)
    and exists(select from angler_private.profiles peer where angler_private.age_years(peer.born_on)>=15
      and peer.user_id=case when t.first_user=actor then t.second_user else t.first_user end)
    and exists(select from angler_messages.entries e where e.thread=t.id and e.position=$2);
  if not found then raise exception 'Message unavailable' using errcode='PT404'; end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.angler_message_read(uuid,bigint) from public,anon;
grant execute on function public.angler_message_read(uuid,bigint) to authenticated;

-- Community alerts require their own opt-in. The background capability returns only per-category cursors.
alter table angler_discussions.post_watches add column community boolean not null default false;
alter table angler_weekly.entries add column alert_position bigint generated always as identity;
alter table angler_market.orders add column rating_position bigint;
create sequence angler_market.rating_positions;
create function angler_market.stamp_rating() returns trigger language plpgsql set search_path='' as $$
begin
  new.rating_position:=case when new.rating_accuracy is not null then nextval('angler_market.rating_positions') end;
  return new;
end $$;
revoke all on function angler_market.stamp_rating() from public,anon,authenticated;
create trigger market_rating_position before update of rating_accuracy on angler_market.orders
  for each row when (new.rating_accuracy is distinct from old.rating_accuracy) execute function angler_market.stamp_rating();

create function public.angler_community_signal(device_key uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid; general boolean;
begin
  select w.owner_id,angler_private.age_years(p.born_on)>=15 into actor,general
    from angler_discussions.post_watches w join angler_private.profiles p on p.user_id=w.owner_id
    join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
    where w.digest=sha256(convert_to($1::text,'UTF8')) and w.expires_at>now() and w.community
    and p.born_on is not null and exists(select from angler_private.acceptances a where a.user_id=p.user_id
      and a.terms_revision='2026-11-26.2' and a.privacy_revision='2026-11-26.2');
  if actor is null then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  return (with groups as (
    select g.id, general or exists(select from angler_private.group_permissions p where p.child=actor and p.group_id=g.id and p.kind='tip') as tips,
      general or exists(select from angler_private.group_permissions p where p.child=actor and p.group_id=g.id and p.kind='catch') as catches
    from angler_groups_private.groups g where g.owner_id=actor or exists(
      select from angler_groups_private.members m where m.user_id=actor and m.group_id=g.id)
  ) select jsonb_build_object(
    'messages',coalesce((select max(e.position) from angler_messages.threads t join angler_messages.entries e on e.thread=t.id
      join angler_private.profiles peer on peer.user_id=case when t.first_user=actor then t.second_user else t.first_user end
      where general and angler_private.age_years(peer.born_on)>=15 and actor in (t.first_user,t.second_user) and e.from_first<>(actor=t.first_user)
      and not (t.first_blocks or t.second_blocks) and e.position>case when t.first_user=actor then t.first_read else t.second_read end),0),
    'replies',coalesce((select max(r.position) from angler_discussions.posts q join angler_discussions.posts r on r.parent=q.id
      where general and q.author_id=actor and q.body is not null and r.author_id<>actor and r.body is not null),0),
    'tips',coalesce((select max(t.position) from angler_groups_private.tips t join groups g on g.id=t.group_id
      where g.tips and t.author_id<>actor and t.body is not null),0),
    'catches',coalesce((select max(p.position) from angler_groups_private.catch_posts p join groups g on g.id=p.group_id
      where g.catches and p.author<>actor and p.caught is not null),0),
    'weekly',coalesce((select max(e.alert_position) from angler_weekly.entries e join groups g on g.id=e.group_id
      where g.catches and e.author<>actor and not e.held and e.photo is not null),0),
    'sales',coalesce((select max(b.id) from angler_market.orders b join angler_market.offers o on o.id=b.offer where general and o.seller=actor),0),
    'ratings',coalesce((select max(b.rating_position) from angler_market.orders b join angler_market.offers o on o.id=b.offer where general and o.seller=actor),0)
  ));
end $$;

create function public.angler_watch_community(device_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.verified_subject();
begin
  delete from angler_discussions.post_watches where expires_at<=now();
  insert into angler_discussions.post_watches(digest,owner_id,expires_at,community)
    values(sha256(convert_to($1::text,'UTF8')),actor,now()+interval '30 days',true)
    on conflict(digest) do update set expires_at=excluded.expires_at
      where post_watches.owner_id=actor and post_watches.community;
  if not found then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  return public.angler_community_signal($1);
end $$;
revoke all on function public.angler_watch_community(uuid),public.angler_community_signal(uuid) from public,anon,authenticated;
grant execute on function public.angler_watch_community(uuid) to authenticated;
grant execute on function public.angler_community_signal(uuid) to anon,authenticated;

-- Resolve the destination after unlock; no question IDs are returned to a background device capability.
create function public.angler_latest_reply() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return coalesce((select jsonb_build_object('water',q.water,'question',q.id)
    from angler_discussions.posts q join angler_discussions.posts r on r.parent=q.id
    where q.author_id=actor and q.body is not null and r.author_id<>actor and r.body is not null
    order by r.position desc limit 1),'{}'::jsonb);
end $$;
revoke all on function public.angler_latest_reply() from public,anon;
grant execute on function public.angler_latest_reply() to authenticated;
