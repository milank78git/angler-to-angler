create function angler_commerce.void_receipt(h text, fund angler_commerce.lots) returns void
language plpgsql security invoker set search_path='' as $$
declare item record;
begin
   insert into angler_commerce.voids values(h,now()) on conflict do nothing;
   if fund.id is not null and not fund.voided then
     update angler_commerce.lots set voided=true where id=fund.id;
     for item in select s.* from angler_commerce.sales s join angler_commerce.allocations a on a.sale=s.id
       where a.lot=fund.id and not s.voided order by s.offer loop
       perform 1 from angler_market.offers where id=item.offer for update;
       update angler_commerce.sales set voided=true where id=item.id;
       delete from angler_market.orders where buyer=item.buyer and offer=item.offer;
       update angler_market.offers set sold=sold-1 where id=item.offer;
     end loop;
   end if;
end $$;

create function angler_commerce.settle_receipt(fund angler_commerce.lots, args jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
   if fund.id is null or args->>'order' is distinct from fund.order_ref or args->>'net' is null then raise exception 'Unknown order'; end if;
   if fund.net_halers is not null and fund.net_halers<>(args->>'net')::integer then raise exception 'Settlement differs'; end if;
   update angler_commerce.lots set net_halers=(args->>'net')::integer,settled_at=coalesce(settled_at,now()) where id=fund.id;
end $$;

create function angler_commerce.credit_receipt(actor uuid, h text, fund angler_commerce.lots, args jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare qty integer;
begin
   if (select mode from angler_commerce.settings) is distinct from args->>'mode' or args->>'mode' not in ('live','test')
      or args->>'order' is null or length(args->>'order')=0 then raise exception 'Incorrect payment environment'; end if;
   qty:=case args->>'sku' when 'credits_50_czk' then 50 when 'credits_100_czk' then 100 end;
   if qty is null or actor is null or not exists(select from angler_private.profiles where user_id=actor) then raise exception 'Invalid purchase'; end if;
   if fund.id is null then
     insert into angler_commerce.lots(holder,source,units,token_hash,order_ref)
       values(actor,'google',qty,h,args->>'order');
   elsif fund.holder is distinct from (args->>'holder')::uuid or fund.units<>qty or fund.order_ref is distinct from args->>'order' then
     raise exception 'Receipt mismatch';
   end if;
end $$;

revoke all on function
  angler_commerce.void_receipt(text,angler_commerce.lots),
  angler_commerce.settle_receipt(angler_commerce.lots,jsonb),
  angler_commerce.credit_receipt(uuid,text,angler_commerce.lots,jsonb)
from public, anon, authenticated;

create or replace function angler_commerce.receipt(op text,args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h text:=args->>'hash'; actor uuid; fund angler_commerce.lots;
begin
 if op='holder' then
   return jsonb_build_object('holder',(select holder from angler_commerce.holders where binding=args->>'binding'));
 end if;
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception 'Invalid receipt'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h,41));
 select * into fund from angler_commerce.lots where token_hash=h;
 actor:=coalesce(fund.holder,(args->>'holder')::uuid);
 if actor is not null then perform pg_advisory_xact_lock(hashtextextended(actor::text,37)); end if;
 if op='void' then
   perform angler_commerce.void_receipt(h,fund);
 else
   if exists(select from angler_commerce.voids where token_hash=h) then raise exception 'Receipt voided'; end if;
   case op
     when 'settle' then perform angler_commerce.settle_receipt(fund,args);
     when 'credit' then perform angler_commerce.credit_receipt(actor,h,fund,args);
     else raise exception 'Unknown receipt action';
   end case;
 end if;
 return '{}'::jsonb;
end $$;
