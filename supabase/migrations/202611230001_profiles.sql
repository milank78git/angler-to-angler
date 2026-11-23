-- Only the verified subject may read or complete its own profile. Documents and timestamps are server-owned.
create schema if not exists angler_private;
revoke all on schema angler_private from public, anon, authenticated;

create table angler_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  created_at timestamptz not null default now()
);
create table angler_private.acceptances (
  user_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  terms_revision text not null, privacy_revision text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id,terms_revision,privacy_revision)
);
alter table angler_private.profiles enable row level security;
alter table angler_private.acceptances enable row level security;
revoke all on all tables in schema angler_private from public, anon, authenticated;

create function public.angler_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.user_id,'name',p.display_name,'current',exists(
    select 1 from angler_private.acceptances a where a.user_id=p.user_id
      and a.terms_revision='2026-11-23' and a.privacy_revision='2026-11-23'))
  from angler_private.profiles p where p.user_id=auth.uid()
    and coalesce(auth.jwt()->>'is_anonymous','false')='false';
$$;

create function public.angler_accept(nickname text, terms text, privacy text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid();
begin
  if subject is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if terms is distinct from '2026-11-23' or privacy is distinct from '2026-11-23' then
    raise exception 'Document revision mismatch' using errcode='22023';
  end if;
  insert into angler_private.profiles(user_id,display_name) values(subject,btrim(nickname))
    on conflict(user_id) do nothing;
  insert into angler_private.acceptances(user_id,terms_revision,privacy_revision)
    values(subject,terms,privacy) on conflict do nothing;
  return public.angler_profile();
end;
$$;
revoke all on function public.angler_profile(),public.angler_accept(text,text,text) from public,anon;
grant execute on function public.angler_profile(),public.angler_accept(text,text,text) to authenticated;
