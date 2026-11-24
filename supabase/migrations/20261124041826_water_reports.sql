insert into angler_discussions.waters(key,zone) values
  ('US-MT:39754243','America/Denver'),
  ('US-MT:39754165','America/Denver'),
  ('US-MT:39754559','America/Denver');
-- Each verified angler contributes at most one current observation per water and category.
create table angler_public_cards.water_reports (
  water text not null references angler_discussions.waters(key),
  category text not null check (category in ('low_water','fish_deaths','closure')),
  reporter uuid not null references auth.users(id) on delete cascade,
  observed_at timestamptz not null default now(),
  primary key(water,category,reporter)
);
alter table angler_public_cards.water_reports enable row level security;
revoke all on angler_public_cards.water_reports from public, anon, authenticated;
create function public.angler_water_report(water_key text, kind text, withdraw boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  if kind not in ('low_water','fish_deaths','closure') or kind is null or withdraw is null
    or not exists(select from angler_discussions.waters where key=water_key)
  then raise exception 'Invalid observation' using errcode='PT422'; end if;
  if withdraw then
    delete from angler_public_cards.water_reports where (water,category,reporter)=(water_key,kind,actor);
  else
    insert into angler_public_cards.water_reports(water,category,reporter) values(water_key,kind,actor)
    on conflict(water,category,reporter) do update set observed_at=now();
  end if;
end $$;
create function public.angler_water_alerts(water_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  return (select coalesce(jsonb_object_agg(category,summary),'{}'::jsonb) from
    (select category,jsonb_build_object('count',count(*),'mine',bool_or(reporter=actor)) summary
     from angler_public_cards.water_reports where water=water_key and observed_at>now()-interval '24 hours'
     group by category) counts);
end $$;
revoke all on function public.angler_water_report(text,text,boolean), public.angler_water_alerts(text) from public,anon;
grant execute on function public.angler_water_report(text,text,boolean), public.angler_water_alerts(text) to authenticated;
