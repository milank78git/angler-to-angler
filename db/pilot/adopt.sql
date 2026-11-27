-- The caller runs this entire file in one transaction, including the catalog checks.
set local search_path=pg_catalog;
set local lock_timeout='8s';
select pg_advisory_xact_lock(104809,5);
lock table supabase_migrations.schema_migrations in share mode;
do $$
declare recorded text;
begin
  select encode(sha256(convert_to(string_agg(version||':'||name||':'||
    encode(sha256(convert_to(btrim(array_to_string(statements,E'\n'),E' \n\r\t'),'UTF8')),'hex'),
    E'\n' order by version),'UTF8')),'hex') into recorded from supabase_migrations.schema_migrations;
  if recorded is distinct from 'ccf01c47d8e61421c6e7fba5971c534729d280172019b25b3be4d818c19b08ae'
    or (select count(*) from supabase_migrations.schema_migrations) <> 40 then
    raise exception 'Unrecognized hosted migration history. Compare the target with db/README.md before adoption.';
  end if;
end $$;
\ir catalog-fingerprint.sql
do $$begin
  if (select digest from pg_temp.pilot_catalog_fingerprint) not in
    ('251ff540a187945bd0bfc03ad531729144fff261925b7ef155a1ebded71f7816',
     '68084782f7f0ec2006042f98bfc84e4b2fd3e654e13725464ca0800c60260a61') then
    raise exception 'Hosted catalog differs from the reviewed legacy and reconciled schemas';
  end if;
end$$;
select digest='251ff540a187945bd0bfc03ad531729144fff261925b7ef155a1ebded71f7816' as needs_repair
from pg_temp.pilot_catalog_fingerprint \gset
\if :needs_repair
  \i :repair_file
\endif
do $$begin
  if (select digest from pg_temp.pilot_catalog_fingerprint) <> '68084782f7f0ec2006042f98bfc84e4b2fd3e654e13725464ca0800c60260a61'
    or has_function_privilege('authenticated','public.angler_accept(text,text,text)','execute')
    or has_function_privilege('anon','public.angler_register(text,text,text,date)','execute') then
    raise exception 'Hosted pilot failed baseline verification';
  end if;
end $$;
create schema if not exists liquibase;
