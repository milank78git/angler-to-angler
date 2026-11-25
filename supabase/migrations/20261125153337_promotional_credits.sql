-- Promotional units unlock tips. Only reconciled purchases can fund monetary allocations.
-- Stop for reconciliation if an existing live installation already promised sponsored proceeds.
lock table angler_commerce.settings, angler_commerce.lots, angler_commerce.allocations
  in share row exclusive mode;
do $$begin
  if exists (select from angler_commerce.settings where environment='live') and exists (
    select from angler_commerce.allocations a join angler_commerce.lots l on l.id=a.lot
    where l.source='welcome' and l.net_halers>0
  ) then
    raise exception 'Reconcile historical live promotional allocations before changing their monetary basis';
  end if;
end$$;

alter table angler_commerce.settings alter column bonus_net_halers set default 0;
update angler_commerce.settings set bonus_net_halers=0;
alter table angler_commerce.settings add constraint promotional_basis_is_zero check (bonus_net_halers=0);
update angler_commerce.lots set net_halers=0 where source='welcome';
alter table angler_commerce.lots add constraint promotional_units_have_no_proceeds
  check (source<>'welcome' or net_halers is not distinct from 0);
