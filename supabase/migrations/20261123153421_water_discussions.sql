-- Water keys survive catalog revisions. Operators enable each new water explicitly.
create schema angler_discussions;
revoke all on schema angler_discussions from public, anon, authenticated;
grant usage on schema angler_discussions to authenticated;
create table angler_discussions.waters (key text primary key, zone text not null);
insert into angler_discussions.waters values ('CZ:401001','Europe/Prague'),('CZ:401009','Europe/Prague');

create table angler_discussions.posts (
  id uuid primary key,
  water text not null references angler_discussions.waters(key),
  parent uuid references angler_discussions.posts(id) on delete cascade,
  author_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  position bigint generated always as identity unique,
  posted_at timestamptz not null default clock_timestamp(),
  body text check (char_length(body) between 1 and 1600 and body ~ '[^[:space:]]'),
  trip_day date check (trip_day is null or parent is not null),
  helpful boolean not null default false check (not helpful or parent is not null)
);
create index discussion_pages on angler_discussions.posts(water,parent,position desc) where body is not null;
create index discussion_replies on angler_discussions.posts(parent) where parent is not null;
create index discussion_by_author on angler_discussions.posts(author_id);
create table angler_discussions.reports (
  post_id uuid not null references angler_discussions.posts(id) on delete cascade,
  reporter uuid not null references angler_private.profiles(user_id) on delete cascade,
  reported_at timestamptz not null default now(),
  primary key(post_id,reporter)
);
create index discussion_reports_by_reporter on angler_discussions.reports(reporter);
alter table angler_discussions.waters enable row level security;
alter table angler_discussions.posts enable row level security;
alter table angler_discussions.reports enable row level security;
revoke all on all tables in schema angler_discussions from public,anon,authenticated;

-- Expose only display fields, including the angler's own ownership flag.
create function angler_discussions.card(p angler_discussions.posts, nickname text, actor uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p.id,'author',nickname,'mine',p.author_id=actor,'body',p.body,
    'postedAt',p.posted_at,'tripDay',p.trip_day,'helpful',p.helpful,
    'reported',exists(select from angler_discussions.reports r where r.post_id=p.id and r.reporter=actor))
$$;

create function angler_discussions.page(target text, thread uuid, cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); question jsonb;
begin
  if not exists(select from angler_discussions.waters w where w.key=target) then
    raise exception 'Unknown water' using errcode='PT404';
  end if;
  if thread is not null then
    select angler_discussions.card(p,a.display_name,actor) into question
      from angler_discussions.posts p join angler_private.profiles a on p.author_id=a.user_id
      where p.id=thread and p.water=target and p.parent is null and p.body is not null;
    if not found then raise exception 'Question unavailable' using errcode='PT404'; end if;
  end if;
  return (
    with batch as (
      select p.position, angler_discussions.card(p,a.display_name,actor) ||
        case when thread is null then jsonb_build_object('replyCount',(select count(*)
          from angler_discussions.posts r where r.parent=p.id and r.body is not null)) else '{}'::jsonb end as item
      from angler_discussions.posts p join angler_private.profiles a on p.author_id=a.user_id
      where p.water=target and ((thread is null and p.parent is null) or p.parent=thread)
        and p.body is not null and (cursor_pos is null or p.position<cursor_pos)
      order by p.position desc limit 21
    ), shown as (select * from batch order by position desc limit 20)
    select jsonb_build_object('question',question,'items',coalesce(jsonb_agg(item order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>20 then min(position)::text end) from shown
  );
end;
$$;

create function angler_discussions.post(target text, thread uuid, request uuid, message text, outing date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); water_zone text;
begin
  select zone into water_zone from angler_discussions.waters where key=target;
  if not found then raise exception 'Unknown water' using errcode='PT404'; end if;
  if request is null or message is null or char_length(message) not between 1 and 1600
    or message !~ '[^[:space:]]' or (outing is not null and
        (thread is null or not isfinite(outing) or outing < date '0001-01-01' or outing>(now() at time zone water_zone)::date)) then
    raise exception 'Invalid discussion post' using errcode='22023';
  end if;
  -- Serialize a reply with withdrawal of its parent and reject nested or cross-water replies.
  if thread is not null then
    perform from angler_discussions.posts p where p.id=thread and p.water=target
      and p.parent is null and p.body is not null for share;
    if not found then raise exception 'Question unavailable' using errcode='PT404'; end if;
  end if;
  insert into angler_discussions.posts(id,water,parent,author_id,body,trip_day)
    values(request,target,thread,actor,message,outing) on conflict(id) do nothing;
  if not found and not exists (select from angler_discussions.posts p where p.id=request and p.author_id=actor
    and p.water=target and p.parent is not distinct from thread and p.body=message and p.trip_day is not distinct from outing)
    then raise exception 'Request already used' using errcode='PT409'; end if;
  return jsonb_build_object('id',request);
end;
$$;

-- Keep only a withdrawn post's identity for retry detection. Purge its text, dates, reports and replies.
create function angler_discussions.remove_content(target text, post uuid, owner_filter uuid) returns jsonb
language plpgsql set search_path='' as $$
begin
  update angler_discussions.posts p set body=null,trip_day=null,helpful=false
    where p.id=post and p.water=target and (owner_filter is null or p.author_id=owner_filter);
  if not found then raise exception 'Post unavailable' using errcode='PT404'; end if;
  delete from angler_discussions.posts p where p.parent=post;
  delete from angler_discussions.reports r where r.post_id=post;
  return '{}'::jsonb;
end;
$$;

create function angler_discussions.withdraw(target text, post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  if actor is null then raise exception 'Verified account required' using errcode='42501'; end if;
  return angler_discussions.remove_content(target,post,actor);
end;
$$;

create function angler_discussions.mark_helpful(target text, answer uuid, marked boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  update angler_discussions.posts a set helpful=marked from angler_discussions.posts q
    where a.id=answer and a.parent=q.id and a.water=target and a.body is not null and q.body is not null
      and q.author_id=actor and a.author_id<>actor and marked is not null;
  if not found then raise exception 'Answer unavailable' using errcode='PT404'; end if;
  return '{}'::jsonb;
end;
$$;

create function angler_discussions.report(target text, post uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  perform from angler_discussions.posts p where p.id=post and p.water=target
    and p.body is not null and p.author_id<>actor for share;
  if not found then raise exception 'Post unavailable' using errcode='PT404'; end if;
  insert into angler_discussions.reports(post_id,reporter) values(post,actor) on conflict do nothing;
  return '{}'::jsonb;
end;
$$;

create function public.angler_water_discussion(water_key text,question_id uuid default null,before_position bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$select angler_discussions.page($1,$2,$3)$$;
create function public.angler_discussion_post(water_key text,question_id uuid,request_id uuid,message text,trip_day date)
returns jsonb language sql security invoker set search_path='' as $$select angler_discussions.post($1,$2,$3,$4,$5)$$;
create function public.angler_discussion_withdraw(water_key text,post_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select angler_discussions.withdraw($1,$2)$$;
create function public.angler_discussion_helpful(water_key text,answer_id uuid,marked boolean)
returns jsonb language sql security invoker set search_path='' as $$select angler_discussions.mark_helpful($1,$2,$3)$$;
create function public.angler_discussion_report(water_key text,post_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select angler_discussions.report($1,$2)$$;
revoke all on all functions in schema angler_discussions from public,anon,authenticated;
grant execute on function angler_discussions.page(text,uuid,bigint),angler_discussions.post(text,uuid,uuid,text,date),
  angler_discussions.withdraw(text,uuid),angler_discussions.mark_helpful(text,uuid,boolean),angler_discussions.report(text,uuid)
  to authenticated;
revoke all on function public.angler_water_discussion(text,uuid,bigint),public.angler_discussion_post(text,uuid,uuid,text,date),
  public.angler_discussion_withdraw(text,uuid),public.angler_discussion_helpful(text,uuid,boolean),public.angler_discussion_report(text,uuid)
  from public,anon,authenticated;
grant execute on function public.angler_water_discussion(text,uuid,bigint),public.angler_discussion_post(text,uuid,uuid,text,date),
  public.angler_discussion_withdraw(text,uuid),public.angler_discussion_helpful(text,uuid,boolean),public.angler_discussion_report(text,uuid)
  to authenticated;
