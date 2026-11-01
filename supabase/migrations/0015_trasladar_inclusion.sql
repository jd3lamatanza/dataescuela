create or replace function public.matricula_trasladar(p_carga bigint, p_ciclo int, p_mes int, p_mover boolean) returns void
language plpgsql security definer set search_path = public as $$
declare k public.matricula_cargas; d public.matricula_cargas; nid bigint;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  select * into k from public.matricula_cargas where id = p_carga and confirmada_at is not null;
  if k.id is null then raise exception 'Carga no encontrada'; end if;
  if p_ciclo = k.ciclo and p_mes = k.mes then raise exception 'Elegí otro período'; end if;
  if not exists (select 1 from public.carga_activa where ciclo = p_ciclo and mes = p_mes) then raise exception 'Período no válido'; end if;
  select * into d from public.matricula_cargas where escuela_id = k.escuela_id and ciclo = p_ciclo and mes = p_mes;
  if d.confirmada_at is not null then raise exception 'La escuela ya tiene una carga en ese período'; end if;
  if p_mover then
    if d.id is not null then delete from public.matricula_cargas where id = d.id; end if;
    update public.matricula_cargas set ciclo = p_ciclo, mes = p_mes, updated_by = auth.uid() where id = k.id;
  else
    if d.id is not null then
      nid := d.id;
      update public.matricula_cargas set confirmada_at = now(), updated_by = auth.uid() where id = nid;
    else
      insert into public.matricula_cargas (escuela_id, ciclo, mes, confirmada_at, updated_by) values (k.escuela_id, p_ciclo, p_mes, now(), auth.uid()) returning id into nid;
    end if;
    insert into public.matricula_datos (carga_id, plan_id, curso_id, turno_id, secciones, matricula, inclusion, asistencia)
      select nid, plan_id, curso_id, turno_id, secciones, matricula, inclusion, asistencia from public.matricula_datos where carga_id = k.id;
  end if;
end $$;
