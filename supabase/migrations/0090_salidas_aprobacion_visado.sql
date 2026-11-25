alter table public.salidas add column visado_nombre text;

update public.salidas s
set visado_nombre = coalesce(
  (select nullif(btrim(i.nombre), '') from public.inspectores i
    where i.user_id = s.visado_por and nullif(btrim(i.nombre), '') is not null order by i.id limit 1),
  (select nullif(btrim(p.name), '') from public.profiles p where p.id = s.visado_por)
)
where s.visado_por is not null;

create function public.salidas_validar_visado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado_id = public._salida_estado_id('Aprobada')
    and (tg_op = 'INSERT' or new.estado_id is distinct from old.estado_id)
    and (new.visado_at is null or new.visado_por is null) then
    raise exception 'La salida debe estar visada por un inspector antes de aprobarse';
  end if;

  if new.visado_por is not null and (tg_op = 'INSERT' or new.visado_por is distinct from old.visado_por) then
    select coalesce(
      (select nullif(btrim(i.nombre), '') from public.inspectores i
        where i.user_id = new.visado_por and nullif(btrim(i.nombre), '') is not null order by i.id limit 1),
      (select nullif(btrim(p.name), '') from public.profiles p where p.id = new.visado_por)
    ) into new.visado_nombre;
    if new.visado_nombre is null then raise exception 'No se encontró el nombre del inspector que visa'; end if;
  elsif new.visado_por is null then
    new.visado_nombre := null;
  end if;
  return new;
end $$;
revoke all on function public.salidas_validar_visado() from public, anon, authenticated;

create trigger salidas_validar_visado
before insert or update of estado_id, visado_at, visado_por on public.salidas
for each row execute function public.salidas_validar_visado();

update public.ayuda_guias
set secciones = secciones || jsonb_build_array(jsonb_build_object(
  'titulo', 'Visado y aprobación',
  'pasos', jsonb_build_array(
    'Un inspector debe visar la salida antes de que pueda aprobarse.',
    'En el detalle de la salida podés consultar la fecha y el nombre del inspector que la visó.'
  )
)), version = version + 1, actualizado = now()
where id = 'salidas' and jsonb_array_length(secciones) < 30
  and not exists (select 1 from jsonb_array_elements(secciones) s where s->>'titulo' = 'Visado y aprobación');
