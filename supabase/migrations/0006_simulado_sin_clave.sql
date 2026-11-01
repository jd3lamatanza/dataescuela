-- En ingreso simulado nunca se exige el cambio de contraseña de la cuenta destino
create or replace function public.mi_perfil() returns jsonb
language sql stable security definer set search_path = public as $$
  with sim as (select (select a.name from public.simulaciones s join public.profiles a on a.id = s.actor_id where s.actor_id = auth.uid()) as simulador)
  select to_jsonb(p) || jsonb_build_object('simulador', sim.simulador)
    || case when sim.simulador is not null then jsonb_build_object('must_change', false) else '{}'::jsonb end
  from public.profiles p, sim where p.id = public.eff_uid() and p.active
$$;
