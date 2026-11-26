-- Keep the licence RPC compatible while deriving age only from the private birth date.
create or replace function angler_groups_private.licence_details(changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := angler_groups_private.subject();
  saved angler_private.angler_details;
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
    expiry_value := (changes->>'expiry')::date;
    lead := changes->>'reminder';
    if expiry_value < date '1900-01-01' or lead not in ('off','week','month')
       or (expiry_value is null and lead <> 'off') then
      raise exception 'Invalid age, expiry or reminder' using errcode='PT422';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,84));
  end if;
  select * into saved from angler_private.angler_details where user_id=actor;
  if changes is not null and row(saved.expires_on,coalesce(saved.reminder,'off'))
      is distinct from row(expiry_value,lead) then
    if (changes->>'revision')::bigint <> coalesce(saved.revision,0) then
      raise exception 'Profile changed on another device' using errcode='PT409';
    end if;
    insert into angler_private.angler_details as d (user_id,expires_on,reminder,revision) values (actor,expiry_value,lead,1)
      on conflict (user_id) do update set expires_on=excluded.expires_on,
        reminder=excluded.reminder,revision=d.revision+1 returning * into saved;
  end if;
  return jsonb_build_object('expiry',saved.expires_on,'reminder',coalesce(saved.reminder,'off'),
    'revision',coalesce(saved.revision,0));
exception when datetime_field_overflow or invalid_datetime_format or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid profile value' using errcode='PT422';
end $$;

alter table angler_private.angler_details drop column age_years;
