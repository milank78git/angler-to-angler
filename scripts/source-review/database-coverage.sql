-- Count calls observed by PostgreSQL in the behavioral and concurrency suites.
-- PostgreSQL may inline eligible SQL functions; a zero for such a function is inconclusive.
select n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as signature,
       l.lanname as language, coalesce(s.calls, 0) as observed_calls
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
left join pg_catalog.pg_stat_user_functions s on s.funcid = p.oid
where n.nspname like 'angler%' or (n.nspname = 'public' and p.proname like 'angler%')
order by signature;
