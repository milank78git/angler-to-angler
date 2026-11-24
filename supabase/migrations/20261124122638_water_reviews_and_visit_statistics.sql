-- Keep the single vote per verified member separate from opt-in trip contributions.
create table angler_activity.water_ratings (
  water text not null references angler_discussions.waters(key),
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  primary key (water, author)
);
alter table angler_activity.water_ratings enable row level security;
revoke all on angler_activity.water_ratings from public, anon, authenticated;

create function angler_activity.rating(w text, score integer, writing boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  if not exists (select from angler_discussions.waters where key=w) then
    raise exception 'Unknown water' using errcode='PT404';
  end if;
  if writing then
    if score is null then
      delete from angler_activity.water_ratings where water=w and author=actor;
    elsif score between 1 and 5 then
      insert into angler_activity.water_ratings(water,author,stars) values(w,actor,score)
      on conflict(water,author) do update set stars=excluded.stars;
    else
      raise exception 'Rating must be between one and five' using errcode='PT422';
    end if;
  end if;
  return (select jsonb_build_object('count',count(*),'average',round(avg(stars),1),
    'mine',max(stars) filter(where author=actor)) from angler_activity.water_ratings where water=w);
end $$;

-- Use the same publication delay and minimum sample as the per-water activity screen.
create function angler_activity.top_waters() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period date := (date_trunc('month', (timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
begin
  perform angler_groups_private.subject();
  return jsonb_build_object('month',period,'waters',(select coalesce(jsonb_agg(to_jsonb(s) order by s.visits desc,s.water),'[]')
    from (select water,count(*) visits from angler_activity.trips
      where water is not null and month_start=period group by water
      having count(*)>=10 and count(distinct author)>=5 order by visits desc,water limit 10) s));
end $$;

create function public.angler_water_rating(water_key text) returns jsonb language sql set search_path=''
as $$select angler_activity.rating(water_key,null,false)$$;
create function public.angler_water_rate(water_key text, stars integer) returns jsonb language sql set search_path=''
as $$select angler_activity.rating(water_key,stars,true)$$;
create function public.angler_top_waters() returns jsonb language sql stable set search_path=''
as $$select angler_activity.top_waters()$$;
revoke all on function angler_activity.rating(text,integer,boolean),angler_activity.top_waters(),
  public.angler_water_rating(text),public.angler_water_rate(text,integer),public.angler_top_waters() from public,anon;
grant execute on function angler_activity.rating(text,integer,boolean),angler_activity.top_waters(),
  public.angler_water_rating(text),public.angler_water_rate(text,integer),public.angler_top_waters() to authenticated;
