\ir ../supabase/migrations/20261124120754_volunteered_species_counts.sql
set local role authenticated;
do $$
declare period date := (date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
  id uuid; v int; r jsonb;
begin
  for i in 1..10 loop
    perform pg_temp.as_user(151+i%5);
    id:=gen_random_uuid();
    v:=(public.angler_activity_change(id,0,'CZ:401009',period,'pike','fly',2)->>'revision')::int;
    perform public.angler_trip_species(id,v,(public.angler_trip_species(id)->>'version')::bigint,'{"Perca fluviatilis":2}');
  end loop;
  r:=public.angler_top_species();
  perform pg_temp.check_that(r->'species' @> '[{"latin":"Perca fluviatilis","fish":20}]','Actual catches were not aggregated');
  perform pg_temp.check_that(not (r->'species' @> '[{"latin":"Esox lucius"}]'),'Target was treated as a catch');
  begin perform public.angler_trip_species(id,v,1,'{"Perca fluviatilis":3}');raise exception 'Excess total accepted';
    exception when sqlstate 'PT422' then null; end;
  perform public.angler_activity_change(id,v);
  perform pg_temp.check_that(public.angler_top_species()->'species'='[]','Withdrawal did not suppress counts');
end $$;
reset role;
