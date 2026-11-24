-- One voluntary enrolment per group and angler. Membership removal also clears enrolment.
create table angler_weekly.monthly_members (
  group_id uuid not null references angler_groups_private.groups(id) on delete cascade,
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check (member_id=author),
  month_start date not null,
  primary key (group_id,author),
  foreign key (group_id,member_id) references angler_groups_private.members(group_id,user_id) on delete cascade
);
alter table angler_weekly.monthly_members enable row level security;
revoke all on angler_weekly.monthly_members from public,anon,authenticated;

create function angler_weekly.monthly(target uuid, joining boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); owner boolean:=angler_groups_private.require_group_access(target,actor);
  period date:=date_trunc('month',timezone('Europe/Prague',now()))::date; result jsonb;
begin
  if joining then
    insert into angler_weekly.monthly_members(group_id,author,member_id,month_start)
      values(target,actor,case when not owner then actor end,period)
      on conflict(group_id,author) do update set month_start=excluded.month_start;
  elsif joining is false then
    delete from angler_weekly.monthly_members where group_id=target and author=actor;
  end if;
  -- Compare each angler's single best weekly entry. Never use private journal records.
  with entrants as (
    select author from angler_weekly.monthly_members where group_id=target and month_start=period
  ), catches as (
    select e.author,e.id,count(v.voter) as votes from entrants m join angler_weekly.entries e on e.author=m.author
    left join angler_weekly.votes v on v.entry_id=e.id
    where e.group_id=target and e.caught>=period and e.caught<period+interval '1 month'
      and e.photo is not null and not e.held group by e.author,e.id
  ), best as (select author,max(votes) score from catches group by author),
  ranked as (select p.display_name,b.score,rank() over(order by b.score desc) place
    from best b join angler_private.profiles p on p.user_id=b.author)
  select jsonb_build_object('month',period,'joined',exists(select from entrants where author=actor),
    'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.place,r.display_name) from ranked r where place<=10),'[]')) into result;
  return result;
end $$;
create function public.angler_group_monthly(group_id uuid,joining boolean default null)
returns jsonb language sql set search_path='' as $$select angler_weekly.monthly(group_id,joining)$$;
revoke all on function angler_weekly.monthly(uuid,boolean), public.angler_group_monthly(uuid,boolean) from public,anon;
grant execute on function angler_weekly.monthly(uuid,boolean), public.angler_group_monthly(uuid,boolean) to authenticated;
