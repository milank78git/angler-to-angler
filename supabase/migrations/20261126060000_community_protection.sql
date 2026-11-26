-- Bound successful user-generated writes across all public and internal RPC entry points.
create table angler_private.write_windows (
  actor uuid not null references angler_private.profiles(user_id) on delete cascade,
  category text not null, started timestamptz not null, used integer not null,
  primary key(actor, category)
);
alter table angler_private.write_windows enable row level security;
revoke all on angler_private.write_windows from public, anon, authenticated;

create function angler_private.limit_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor_id uuid := auth.uid(); current_time_utc timestamptz := statement_timestamp();
begin
  if actor_id is null then return null; end if;
  insert into angler_private.write_windows as w values(actor_id, tg_argv[0], current_time_utc, 1)
    on conflict(actor,category) do update set
      used=case when w.started <= excluded.started-interval '1 hour' then 1 else w.used+1 end,
      started=case when w.started <= excluded.started-interval '1 hour' then excluded.started else w.started end
    where w.started <= excluded.started-interval '1 hour' or w.used < tg_argv[1]::integer;
  if not found then raise exception 'Hourly write limit reached' using errcode='PT429'; end if;
  return null;
end $$;
revoke all on function angler_private.limit_write() from public, anon, authenticated;

create trigger limit_posts after insert on angler_discussions.posts
  for each row execute function angler_private.limit_write('posts','40');
create trigger limit_messages after insert on angler_messages.entries
  for each row execute function angler_private.limit_write('messages','120');
create trigger limit_reports after update of reported_at on angler_messages.entries
  for each row when (old.reported_at is distinct from new.reported_at) execute function angler_private.limit_write('reports','20');
create trigger limit_tips after insert on angler_market.versions
  for each row execute function angler_private.limit_write('tips','20');
create trigger limit_tips after insert on angler_groups_private.tips
  for each row execute function angler_private.limit_write('tips','20');
create trigger limit_groups after insert on angler_groups_private.groups
  for each row execute function angler_private.limit_write('groups','6');
create trigger limit_parking after insert or update of revision on angler_activity.parking_points
  for each row execute function angler_private.limit_write('parking','20');
create trigger limit_ratings after insert or update on angler_activity.parking_reviews
  for each row execute function angler_private.limit_write('ratings','40');
create trigger limit_ratings after insert or update on angler_activity.water_ratings
  for each row execute function angler_private.limit_write('ratings','40');
create trigger limit_ratings after update of rating_accuracy on angler_market.orders
  for each row when (new.rating_accuracy is not null and old.rating_accuracy is null) execute function angler_private.limit_write('ratings','40');
create trigger limit_reports after insert on angler_discussions.reports
  for each row execute function angler_private.limit_write('reports','20');
create trigger limit_reports after insert on angler_weekly.reports
  for each row execute function angler_private.limit_write('reports','20');
create trigger limit_reports after insert or update on angler_public_cards.water_reports
  for each row execute function angler_private.limit_write('reports','20');
create trigger limit_cards after insert on angler_public_cards.cards
  for each row execute function angler_private.limit_write('cards','25');

-- One actionable flag per immutable catch card, published profile revision or parking revision.
-- Anonymous readers can flag only a known, live catch token. Repeated flags create no extra rows.
create table angler_private.content_reports (
  id bigint generated always as identity primary key,
  catch_card uuid references angler_public_cards.cards(token) on delete cascade,
  profile uuid references angler_private.profile_cards(user_id) on delete cascade,
  parking uuid references angler_activity.parking_points(id) on delete cascade,
  revision integer not null, submitted_at timestamptz not null default now(), resolved_at timestamptz,
  check (num_nonnulls(catch_card,profile,parking)=1),
  unique(catch_card), unique(profile,revision), unique(parking,revision)
);
alter table angler_private.content_reports enable row level security;
revoke all on angler_private.content_reports from public,anon,authenticated;
create index pending_content_reports on angler_private.content_reports(id) where resolved_at is null;
create trigger limit_reports after insert on angler_private.content_reports
  for each row execute function angler_private.limit_write('reports','20');

create function public.angler_report_catch_card(link_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into angler_private.content_reports(catch_card,revision)
    select token,1 from angler_public_cards.cards where token=link_id and details is not null
    on conflict (catch_card) do nothing;
  return '{}'::jsonb;
end $$;
revoke all on function public.angler_report_catch_card(uuid) from public;
grant execute on function public.angler_report_catch_card(uuid) to anon,authenticated;

create function public.angler_report_content(kind text,target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject(); current_revision integer;
begin
  if kind='profile' then
    select revision into strict current_revision from angler_private.profile_cards
      where user_id=target and shared and user_id<>actor;
    insert into angler_private.content_reports(profile,revision) values(target,current_revision) on conflict do nothing;
  elsif kind='parking' then
    select revision into strict current_revision from angler_activity.parking_points where id=target;
    insert into angler_private.content_reports(parking,revision) values(target,current_revision) on conflict do nothing;
  else raise exception 'Unknown report type' using errcode='PT422';
  end if;
  return '{}'::jsonb;
exception when no_data_found then raise exception 'Content unavailable' using errcode='PT404';
end $$;
revoke all on function public.angler_report_content(text,uuid) from public,anon;
grant execute on function public.angler_report_content(text,uuid) to authenticated;

-- Preserve recoverable positions, including the catalogue position before its first correction.
create table angler_activity.parking_history (
  point uuid not null references angler_activity.parking_points(id) on delete cascade,
  revision integer not null, name text, lat numeric not null, lon numeric not null,
  primary key(point,revision)
);
alter table angler_activity.parking_history enable row level security;
revoke all on angler_activity.parking_history from public,anon,authenticated;
create function angler_activity.archive_parking() returns trigger language plpgsql set search_path='' as $$
begin
  insert into angler_activity.parking_history values(old.id,old.revision,old.name,old.lat,old.lon);
  return null;
end $$;
revoke all on function angler_activity.archive_parking() from public,anon,authenticated;
create trigger archive_parking after update of revision on angler_activity.parking_points
  for each row when(old.revision<>new.revision) execute function angler_activity.archive_parking();

-- An operator can restore a historical position without reversing a concurrent later edit.
create function angler_activity.restore_parking(point_id uuid, expected integer, previous integer) returns void
language plpgsql set search_path='' as $$
begin
  update angler_activity.parking_points p set name=h.name,lat=h.lat,lon=h.lon,editor=null,revision=p.revision+1
    from angler_activity.parking_history h where p.id=point_id and h.point=p.id
    and p.revision=expected and h.revision=previous;
  if not found then raise exception 'Revision unavailable' using errcode='PT409'; end if;
end $$;
revoke all on function angler_activity.restore_parking(uuid,integer,integer) from public,anon,authenticated;
