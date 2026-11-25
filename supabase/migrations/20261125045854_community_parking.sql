-- A stable point ID connects the packaged catalogue, member corrections, directions and reviews.
create table angler_activity.parking_points (
  id uuid primary key,
  water text not null references angler_discussions.waters(key),
  name text check (char_length(name) between 1 and 80),
  lat numeric(10,7) not null check (lat between -90 and 90),
  lon numeric(10,7) not null check (lon between -180 and 180),
  revision integer not null default 1 check (revision > 0),
  editor uuid references angler_private.profiles(user_id) on delete set null,
  unique(water,lat,lon)
);
create table angler_activity.parking_reviews (
  id bigint generated always as identity primary key,
  point uuid not null references angler_activity.parking_points(id) on delete cascade,
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  stars smallint check (stars between 1 and 5),
  note text check (char_length(note) between 1 and 500),
  check (stars is not null or note is not null),
  unique(point,author)
);
create index parking_notes_page on angler_activity.parking_reviews(point,id desc) where note is not null;
alter table angler_activity.parking_points enable row level security;
alter table angler_activity.parking_reviews enable row level security;
revoke all on angler_activity.parking_points,angler_activity.parking_reviews from public,anon,authenticated;

insert into angler_activity.parking_points(id,water,lon,lat) values
  (md5('parking.pikovice')::uuid,'CZ:401009',14.4263203,49.8770658),
  (md5('parking.lipno')::uuid,'CZ:CRS:4615686',14.220378,48.644036),
  (md5('parking.frymburk')::uuid,'CZ:CRS:4615686',14.1710583,48.6594239),
  (md5('parking.podolsko')::uuid,'CZ:CRS:4615396',14.2760753,49.3592758);

create function angler_activity.parking_waters() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform angler_groups_private.subject();
  return (select coalesce(jsonb_agg(distinct water),'[]') from angler_activity.parking_points);
end $$;

create function angler_activity.parking_list(w text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform angler_groups_private.subject();
  return (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from (
    select a.id,a.name,a.lat,a.lon,a.revision,
           round(avg(r.stars),1) as average,count(r.stars) as votes,count(r.note) as notes
    from angler_activity.parking_points a left join angler_activity.parking_reviews r on r.point=a.id
    where a.water=w group by a.id
  ) p);
end $$;

-- The client reuses its ID on retries. A revision check prevents a stale map from moving a newer pin.
create function angler_activity.parking_save(w text,p uuid,version integer,y numeric,x numeric,title text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject(); saved angler_activity.parking_points%rowtype;
begin
  title := nullif(btrim(title),'');
  if p is null or version is null or version<0 or y is null or x is null
    or not(y between -90 and 90 and x between -180 and 180) or char_length(title)>80 then
    raise exception 'Invalid parking point' using errcode='PT422';
  end if;
  if not exists(select from angler_discussions.waters where key=w) then
    raise exception 'Unknown water' using errcode='PT404';
  end if;
  if version=0 then
    insert into angler_activity.parking_points(id,water,name,lat,lon,editor) values(p,w,title,y,x,actor)
      on conflict(id) do nothing returning * into saved;
  else
    update angler_activity.parking_points set name=title,lat=y,lon=x,editor=actor,revision=revision+1
      where id=p and water=w and revision=version returning * into saved;
  end if;
  if saved.id is null then
    select * into saved from angler_activity.parking_points where id=p and water=w;
    if not found or saved.revision<>version+1 or saved.editor is distinct from actor
      or saved.name is distinct from title or saved.lat<>round(y,7) or saved.lon<>round(x,7) then
      raise exception 'Point changed; reopen it' using errcode='PT409';
    end if;
  end if;
  return jsonb_build_object('id',p,'revision',saved.revision);
exception when unique_violation then raise exception 'A point already exists here' using errcode='PT409';
end $$;

-- Ratings and notes are independent. Saving an empty review withdraws only the caller's contribution.
create function angler_activity.parking_feedback(p uuid, writing boolean,score integer,message text,older bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject(); result jsonb;
begin
  if not exists(select from angler_activity.parking_points where id=p) then
    raise exception 'Unknown parking point' using errcode='PT404';
  end if;
  if writing then
    message := nullif(btrim(message),'');
    if score not between 1 and 5 or char_length(message)>500 then
      raise exception 'Invalid review' using errcode='PT422';
    end if;
    if score is null and message is null then
      delete from angler_activity.parking_reviews where point=p and author=actor;
    else
      insert into angler_activity.parking_reviews(point,author,stars,note) values(p,actor,score,message)
        on conflict(point,author) do update set stars=excluded.stars,note=excluded.note;
    end if;
  end if;
  select jsonb_build_object('average',round(avg(stars),1),'votes',count(stars),'notes',count(note),
    'myStars',max(stars) filter(where author=actor),'myNote',max(note) filter(where author=actor))
    into result from angler_activity.parking_reviews where point=p;
  return result || (with page as (
    select id,note from angler_activity.parking_reviews where point=p and note is not null and (older is null or id<older)
      order by id desc limit 21
  ), shown as (select * from page order by id desc limit 20)
  select jsonb_build_object('items',coalesce(jsonb_agg(note order by id desc),'[]'),
    'next',case when (select count(*) from page)>20 then min(id)::text end) from shown);
end $$;

create function public.angler_parking_waters() returns jsonb language sql stable set search_path=''
as $$select jsonb_build_object('waters',angler_activity.parking_waters())$$;
create function public.angler_parking_list(water_key text) returns jsonb language sql stable set search_path=''
as $$select jsonb_build_object('points',angler_activity.parking_list(water_key))$$;
create function public.angler_parking_save(water_key text,point_id uuid,expected_revision integer,lat numeric,lon numeric,title text default null)
returns jsonb language sql set search_path='' as $$select angler_activity.parking_save(water_key,point_id,expected_revision,lat,lon,title)$$;
create function public.angler_parking_feedback(point_id uuid,before_id bigint default null) returns jsonb language sql set search_path=''
as $$select angler_activity.parking_feedback(point_id,false,null,null,before_id)$$;
create function public.angler_parking_review(point_id uuid,stars integer,note text) returns jsonb language sql set search_path=''
as $$select angler_activity.parking_feedback(point_id,true,stars,note,null)$$;

revoke all on function angler_activity.parking_waters(),angler_activity.parking_list(text),
  angler_activity.parking_save(text,uuid,integer,numeric,numeric,text),angler_activity.parking_feedback(uuid,boolean,integer,text,bigint),
  public.angler_parking_waters(),public.angler_parking_list(text),public.angler_parking_save(text,uuid,integer,numeric,numeric,text),
  public.angler_parking_feedback(uuid,bigint), public.angler_parking_review(uuid,integer,text) from public,anon;
grant execute on function angler_activity.parking_waters(),angler_activity.parking_list(text),
  angler_activity.parking_save(text,uuid,integer,numeric,numeric,text),angler_activity.parking_feedback(uuid,boolean,integer,text,bigint),
  public.angler_parking_waters(),public.angler_parking_list(text),public.angler_parking_save(text,uuid,integer,numeric,numeric,text),
  public.angler_parking_feedback(uuid,bigint), public.angler_parking_review(uuid,integer,text) to authenticated;
