create or replace function angler_market.publish_validated_draft(offer_id uuid, expected_revision integer, draft jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); o angler_market.offers; v angler_market.versions;
  zone text := coalesce(draft->>'timeZone', 'Europe/Prague');
  new_offer boolean:=false; prior angler_market.versions;
begin
 if offer_id is null or expected_revision is null or expected_revision<0 or jsonb_typeof(draft) is distinct from 'object'
   or length(draft::text)>16000 then raise exception 'Invalid offer' using errcode='PT422'; end if;
 -- Legacy clients omit timeZone. New clients send the selected venue zone or the device zone for a private location.
 if draft->>'water' is not null then
   select w.zone into zone from angler_discussions.waters w where w.key=draft->>'water';
   if zone is null then raise exception 'Unknown water time zone' using errcode='PT422'; end if;
 end if;
 if length(zone)>80 or not exists(select from pg_catalog.pg_timezone_names where name=zone)
    then raise exception 'Invalid fishing time zone' using errcode='PT422'; end if;
 draft:=draft-'timeZone';
 v.title:=btrim(draft->>'title'); v.species:=btrim(draft->>'species'); v.access:=draft->>'access';
 v.water:=draft->>'water'; v.trip_day:=(draft->>'day')::date; v.technique:=btrim(draft->>'technique');
 v.price:=(draft->>'price')::integer; v.sale_limit:=(draft->>'limit')::integer;
 if (v.trip_day between date '1900-01-01' and (statement_timestamp() at time zone zone)::date
    and length(v.title) between 1 and 80 and length(v.species) between 1 and 60
    and length(v.technique) between 10 and 2000 and v.access in ('shore','boat','both')
    and v.price between 1 and 100 and (v.sale_limit is null or v.sale_limit between 1 and 10000)) is not true
    or (v.water is not null and not exists(select from angler_public_cards.waters where key=v.water))
    or draft<>jsonb_build_object('title',v.title,'species',v.species,'access',v.access,'day',v.trip_day,
       'water',v.water,'technique',v.technique,'price',v.price,'limit',v.sale_limit)
 then raise exception 'Invalid technique offer' using errcode='PT422'; end if;
 if expected_revision=0 then
   insert into angler_market.offers(id,seller) values(offer_id,actor) on conflict do nothing returning * into o;
   new_offer:=found;
 end if;
 if not new_offer then
   select * into o from angler_market.offers where id=offer_id and seller=actor for update;
   if not found or o.withdrawn then raise exception 'Offer unavailable' using errcode='PT404'; end if;
   select * into prior from angler_market.versions where offer=offer_id and revision=o.revision;
   v.offer:=offer_id; v.revision:=o.revision;
   if expected_revision in (o.revision,o.revision-1) and prior is not distinct from v then
     return jsonb_build_object('id',o.id,'revision',o.revision);
   end if;
   if o.revision<>expected_revision or v.sale_limit<o.sold then raise exception 'Offer changed' using errcode='PT409'; end if;
   update angler_market.offers set revision=revision+1 where id=offer_id returning * into o;
 end if;
 v.offer:=offer_id; v.revision:=o.revision;
 insert into angler_market.versions select v.*;
 return jsonb_build_object('id',o.id,'revision',o.revision);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'Invalid offer value' using errcode='PT422';
end$$;

-- Only independent evidence reviews can establish the privacy floor for public aggregates.
-- All voluntary contributions still count once a cell has enough independently reviewed contributors.
create function angler_activity.reviewed_contributor(person uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select from angler_private.catch_evidence e where e.user_id=person
   and e.reviewer is not null and e.reviewer<>person and e.outcome in ('measured','estimated'));
$$;
revoke all on function angler_activity.reviewed_contributor(uuid) from public,anon,authenticated;
create index if not exists catch_evidence_reviewed_contributor on angler_private.catch_evidence(user_id)
 where reviewer is not null and reviewer<>user_id and outcome in ('measured','estimated');


create or replace function angler_activity.summary(w text,requested date,s angler_activity.target,k angler_activity.method)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
  latest date:=(date_trunc('month',(today-7)::timestamp)-interval '1 month')::date;
  m date:=coalesce(requested,latest); sample jsonb;
begin
  perform angler_groups_private.subject();
  if not exists(select from angler_discussions.waters where key=w) then raise exception 'Unknown water' using errcode='PT404'; end if;
  if not isfinite(m) or extract(day from m)<>1 or m>latest or m<date '1900-01-01' then
    raise exception 'Unavailable period' using errcode='PT422'; end if;
  with base as (select author,target,method,fish from angler_activity.trips where water=w and month_start=m),
    -- GROUPING bits: 0 = both dimensions, 1 = target, 2 = method, 3 = whole water.
    sizes as (select grouping(target,method) dimensions,count(*) trips,count(distinct author) filter(where angler_activity.reviewed_contributor(author)) anglers
      from base group by grouping sets ((target,method),(target),(method),())),
    safe as (select bool_and(trips>=10 and anglers>=5) filter(where dimensions=0) joint,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=1) species,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=2) methods,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=3) overall from sizes)
    select jsonb_build_object('trips',count(*),'anglers',count(distinct author),'fish',sum(fish),
      'successfulTrips',case when min(fish)=0 then count(*) filter(where fish>0) end)
      into sample from base cross join safe
      where overall and (s is null or target=s) and (k is null or method=k)
        and (s is null and k is null or joint or species and k is null or not species and methods and s is null)
      having count(*)>0;
  return jsonb_build_object('month',m,'latest',latest,'sample',sample);
end
$$;

create or replace function angler_activity.top_waters() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period date := (date_trunc('month', (timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
begin
  perform angler_groups_private.subject();
  return jsonb_build_object('month',period,'waters',(select coalesce(jsonb_agg(to_jsonb(s) order by s.visits desc,s.water),'[]')
    from (select water,count(*) visits from angler_activity.trips
      where water is not null and month_start=period group by water
      having count(*)>=10 and count(distinct author) filter(where angler_activity.reviewed_contributor(author))>=5 order by visits desc,water limit 10) s));
end $$;

create or replace function angler_activity.top_species() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period date:=(date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
begin
  perform angler_groups_private.subject();
  return jsonb_build_object('month',period,'species',(select coalesce(jsonb_agg(to_jsonb(r) order by r.fish desc,r.latin),'[]')
    from (select f.key latin,sum(f.value::integer) fish from angler_activity.trips t cross join lateral jsonb_each_text(t.species_counts) f
      where t.water is not null and t.month_start=period group by f.key having count(*)>=10 and count(distinct author) filter(where angler_activity.reviewed_contributor(author))>=5
      order by fish desc,latin limit 10) r));
end $$;

create function angler_private.nickname_key(value text) returns text
language sql immutable strict set search_path='' as $$
 select lower(btrim(regexp_replace(normalize(value, NFKC), '[[:space:]]+', ' ', 'g')));
$$;
revoke all on function angler_private.nickname_key(text) from public,anon,authenticated;

alter table angler_private.profiles add column original_display_name text;
do $$
declare p record; candidate text; suffix text; counter integer;
begin
 for p in select user_id,display_name from (
   select user_id,display_name,row_number() over(partition by angler_private.nickname_key(display_name)
     order by created_at,user_id) as occurrence from angler_private.profiles
 ) duplicates where occurrence>1 order by user_id loop
   counter:=0;
   loop
     suffix:=' #'||left(replace(p.user_id::text,'-',''),8)||case when counter=0 then '' else '-'||counter end;
     candidate:=left(p.display_name,60-length(suffix))||suffix;
     exit when not exists(select from angler_private.profiles
       where angler_private.nickname_key(display_name)=angler_private.nickname_key(candidate));
     counter:=counter+1;
   end loop;
   update angler_private.profiles set original_display_name=p.display_name, display_name=candidate where user_id=p.user_id;
 end loop;
end $$;
create unique index profiles_unique_nickname on angler_private.profiles(angler_private.nickname_key(display_name));


create or replace function public.angler_accept(nickname text, terms text, privacy text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid();
begin
  if subject is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if terms is distinct from '2026-11-23' or privacy is distinct from '2026-11-23' then
    raise exception 'Document revision mismatch' using errcode='22023';
  end if;
  if not exists(select from angler_private.profiles where user_id=subject) then
    begin
      insert into angler_private.profiles(user_id,display_name) values(subject,btrim(nickname))
        on conflict(user_id) do nothing;
    exception when unique_violation then
      if not exists(select from angler_private.profiles where user_id=subject) then
        raise exception 'Display name already used' using errcode='PT409';
      end if;
    end;
  end if;
  insert into angler_private.acceptances(user_id,terms_revision,privacy_revision)
    values(subject,terms,privacy) on conflict do nothing;
  return public.angler_profile();
end;
$$;

create or replace function angler_commerce.receipt(op text,args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h text:=args->>'hash'; actor uuid; fund angler_commerce.lots;
begin
 if op='holder' then
   return jsonb_build_object('holder',(select holder from angler_commerce.holders where binding=args->>'binding'));
 end if;
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception 'Invalid receipt'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h,41));
 select * into fund from angler_commerce.lots where token_hash=h;
 actor:=coalesce(fund.holder,(args->>'holder')::uuid);
 if actor is not null then perform pg_advisory_xact_lock(hashtextextended(actor::text,37)); end if;
 if op='void' then
   perform angler_commerce.void_receipt(h,fund);
 else
   if exists(select from angler_commerce.voids where token_hash=h) then raise exception 'Receipt voided' using errcode='PT410'; end if;
   case op
     when 'settle' then perform angler_commerce.settle_receipt(fund,args);
     when 'credit' then perform angler_commerce.credit_receipt(actor,h,fund,args);
     else raise exception 'Unknown receipt action';
   end case;
 end if;
 return '{}'::jsonb;
end $$;
