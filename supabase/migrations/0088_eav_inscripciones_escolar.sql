alter table public.eav_preinscripciones
  add column inscrito_en timestamptz,
  add column legajo_completo boolean,
  add column inscrito_por uuid references public.profiles(id) on delete set null,
  add constraint eav_inscripcion_legajo_check check (
    (inscrito_en is null and legajo_completo is null and inscrito_por is null)
    or (inscrito_en is not null and legajo_completo is not null)
  );

create index eav_preinscripciones_escuela_lista_idx
  on public.eav_preinscripciones (escuela_eav_id, temporada desc, creado_en desc, id desc);

create policy eav_preinscripciones_escolar on public.eav_preinscripciones
for select to authenticated using (
  public.app_role() = 'escolar'
  and public.real_role() in ('escolar', 'distrital')
  and escuela_eav_id = public.mi_escuela()
);

create function public.eav_confirmar_inscripcion(p_id bigint, p_legajo_completo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar'
    or coalesce(public.real_role(), '') not in ('escolar', 'distrital') then
    raise exception 'Sin permiso';
  end if;
  if p_legajo_completo is null then raise exception 'Indicá el estado del legajo'; end if;
  if not exists (select 1 from public.escuelas where id=public.mi_escuela() and eav='Sí') then
    raise exception 'La escuela no está activa en Escuela de Verano';
  end if;
  update public.eav_preinscripciones
  set inscrito_en=now(), legajo_completo=p_legajo_completo, inscrito_por=public.eff_uid()
  where id=p_id and escuela_eav_id=public.mi_escuela() and inscrito_en is null;
  if not found then raise exception 'La preinscripción no está disponible o ya fue confirmada'; end if;
end $$;
revoke all on function public.eav_confirmar_inscripcion(bigint, boolean) from public, anon;
grant execute on function public.eav_confirmar_inscripcion(bigint, boolean) to authenticated;

update public.ayuda_guias
set secciones=secciones || jsonb_build_array(jsonb_build_object(
  'titulo', 'Confirmar inscripciones',
  'pasos', jsonb_build_array(
    'Abrí la pestaña «Preinscripciones» para consultar los estudiantes de tu escuela de verano.',
    'Elegí «Confirmar inscripción», indicá si la documentación del legajo está completa y confirmá. El estudiante queda inscripto aunque el legajo esté incompleto.',
    'Los estudiantes inscriptos permanecen en la lista con el estado del legajo.'
  )
)), version=version+1, actualizado=now()
where modulo='eav-escolar' and jsonb_array_length(secciones)<30
  and not exists (select 1 from jsonb_array_elements(secciones) s where s->>'titulo'='Confirmar inscripciones');
