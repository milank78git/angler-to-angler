-- Keep the reader origin under the operator's control for each deployment.
create table angler_public_cards.reader (
  singleton boolean primary key default true check (singleton),
  base_url text not null check (base_url ~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~-]+)*/$')
);
alter table angler_public_cards.reader enable row level security;
revoke all on angler_public_cards.reader from public,anon,authenticated;
insert into angler_public_cards.reader(base_url) values ('https://milank78git.github.io/angler-to-angler/catch-card/');

create or replace function angler_public_cards.owner_item(link uuid,details jsonb) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',link,'url',base_url||'#'||link,'species',details->>'species',
    'date',details->>'date','precision',details->>'precision') from angler_public_cards.reader
$$;
