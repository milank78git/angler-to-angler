-- These optional fields belong only to the authenticated angler, independently of the public card.
create table angler_private.angler_details (
  user_id uuid primary key references angler_private.profiles(user_id) on delete cascade,
  age_years smallint check (age_years between 0 and 125),
  expires_on date check (expires_on between date '1900-01-01' and date '9999-12-31'),
  reminder text not null check (reminder in ('off','week','month') and (expires_on is not null or reminder='off')),
  revision integer not null check (revision > 0)
);
alter table angler_private.angler_details enable row level security;
revoke all on angler_private.angler_details from public,anon,authenticated;

-- No input identifies a user. Old app versions can still update the public card independently.
create function angler_groups_private.my_details(changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := angler_groups_private.subject();
  saved angler_private.angler_details;
  age_value smallint;
  expiry_value date;
  lead text;
begin
  if changes is not null then
    if jsonb_typeof(changes) <> 'object' or not (changes ?& array['age','expiry','reminder','revision'])
      or changes - array['age','expiry','reminder','revision'] <> '{}'
      or jsonb_typeof(changes->'age') not in ('number','null') or changes->>'age' !~ '^[0-9]{1,3}$'
      or jsonb_typeof(changes->'expiry') not in ('string','null') or changes->>'expiry' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(changes->'revision') <> 'number' or changes->>'revision' !~ '^[0-9]{1,10}$'
      or jsonb_typeof(changes->'reminder') <> 'string' then
      raise exception 'Incorrect profile fields' using errcode='PT422';
    end if;
    age_value := (changes->>'age')::smallint;
    expiry_value := (changes->>'expiry')::date;
    lead := changes->>'reminder';
    if age_value > 125 or expiry_value < date '1900-01-01' or lead not in ('off','week','month')
       or (expiry_value is null and lead <> 'off') then
      raise exception 'Invalid age, expiry or reminder' using errcode='PT422';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,84));
  end if;
  select * into saved from angler_private.angler_details where user_id=actor;
  if changes is not null and row(saved.age_years,saved.expires_on,coalesce(saved.reminder,'off'))
      is distinct from row(age_value,expiry_value,lead) then
    if (changes->>'revision')::bigint <> coalesce(saved.revision,0) then
      raise exception 'Profile changed on another device' using errcode='PT409';
    end if;
    insert into angler_private.angler_details as d values (actor,age_value,expiry_value,lead,1)
      on conflict (user_id) do update set age_years=excluded.age_years,expires_on=excluded.expires_on,
        reminder=excluded.reminder,revision=d.revision+1 returning * into saved;
  end if;
  return jsonb_build_object('age',saved.age_years,'expiry',saved.expires_on,'reminder',coalesce(saved.reminder,'off'),
    'revision',coalesce(saved.revision,0));
exception when datetime_field_overflow or invalid_datetime_format or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid profile value' using errcode='PT422';
end $$;

-- Match the existing verified profile-card RPC pattern.
create function public.angler_my_details(changes jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$ select angler_groups_private.my_details(changes) $$;
revoke all on function angler_groups_private.my_details(jsonb),public.angler_my_details(jsonb) from public,anon,authenticated;
grant execute on function angler_groups_private.my_details(jsonb),public.angler_my_details(jsonb) to authenticated;
