create or replace function public.angler_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.user_id,'name',p.display_name,'current',exists(
    select 1 from angler_private.acceptances a where a.user_id=p.user_id
      and a.terms_revision='2026-11-26' and a.privacy_revision='2026-11-26'))
  from angler_private.profiles p where p.user_id=auth.uid()
    and coalesce(auth.jwt()->>'is_anonymous','false')='false';
$$;

create or replace function public.angler_accept(nickname text, terms text, privacy text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid();
begin
  if subject is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'Verified account required' using errcode='42501';
  end if;
  if terms is distinct from '2026-11-26' or privacy is distinct from '2026-11-26' then
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
