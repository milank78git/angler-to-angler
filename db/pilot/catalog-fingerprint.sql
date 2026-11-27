-- Compare the managed catalog without using internal object IDs or physical column order.
create temporary view pilot_catalog_fingerprint as
with objects(definition) as (
  select concat_ws('|','function',n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes),
    pg_catalog.format_type(p.prorettype,null),p.prosecdef,p.provolatile,p.proconfig,p.prosrc)
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname like 'angler\_%' or (n.nspname='public' and left(p.proname,7)='angler_')
  union all
  select concat_ws('|','column',n.nspname,c.relname,c.relrowsecurity,a.attname,
    pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity)
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid
  where n.nspname like 'angler\_%' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
  union all
  select concat_ws('|','trigger',n.nspname,c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid))
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname like 'angler\_%' and not t.tgisinternal
  union all
  select concat_ws('|','constraint',n.nspname,c.relname,k.conname,k.convalidated,pg_catalog.pg_get_constraintdef(k.oid))
  from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname like 'angler\_%'
  union all
  select concat_ws('|','index',n.nspname,c.relname,i.indisvalid,pg_catalog.pg_get_indexdef(i.indexrelid))
  from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname like 'angler\_%'
)
select encode(sha256(convert_to(string_agg(definition,E'\n' order by definition collate "C"),'UTF8')),'hex') as digest
from objects;
