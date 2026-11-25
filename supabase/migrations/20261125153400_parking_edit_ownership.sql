-- An older edited row records only the last editor. Its creator cannot be recovered.
alter table angler_activity.parking_points add column creator uuid
  references angler_private.profiles(user_id) on delete set null;
update angler_activity.parking_points set creator=editor where revision=1 and editor is not null;

create or replace function angler_activity.parking_list(w text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  return (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from (
    select a.id,a.name,a.lat,a.lon,a.revision,
           coalesce(a.creator=actor,false) as "canEdit",
           round(avg(r.stars),1) as average,count(r.stars) as votes,count(r.note) as notes
    from angler_activity.parking_points a left join angler_activity.parking_reviews r on r.point=a.id
    where a.water=w group by a.id
  ) p);
end $$;

-- The client reuses its ID on retries. A revision check prevents a stale map from moving a newer pin.
create or replace function angler_activity.parking_save(w text,p uuid,version integer,y numeric,x numeric,title text)
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
    insert into angler_activity.parking_points(id,water,name,lat,lon,editor,creator) values(p,w,title,y,x,actor,actor)
      on conflict(id) do nothing returning * into saved;
  else
    update angler_activity.parking_points set name=title,lat=y,lon=x,editor=actor,revision=revision+1
      where id=p and water=w and creator=actor and revision=version returning * into saved;
  end if;
  if saved.id is null then
    select * into saved from angler_activity.parking_points where id=p and water=w;
    if found and saved.creator is distinct from actor then
      raise exception 'Only the creator can edit this point' using errcode='PT403';
    end if;
    if not found or saved.revision<>version+1 or saved.editor is distinct from actor
      or saved.name is distinct from title or saved.lat<>round(y,7) or saved.lon<>round(x,7) then
      raise exception 'Point changed; reopen it' using errcode='PT409';
    end if;
  end if;
  return jsonb_build_object('id',p,'revision',saved.revision);
exception when unique_violation then raise exception 'A point already exists here' using errcode='PT409';
end $$;
