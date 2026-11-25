create function public.escuela_reset_cuenta(p_escuela bigint, p_rol text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital'
    or public.eff_uid() is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
  if p_rol is null or p_rol not in ('escolar', 'eav', 'eoe') then raise exception 'Tipo de cuenta inválido'; end if;
  if not public.can_see_escuela(p_escuela) then raise exception 'Sin permiso'; end if;
  if p_rol = 'escolar' then
    perform public.escuela_reset(p_escuela);
    return;
  end if;
  select p.id into uid from public.profiles p join public.escuelas e on e.id = p_escuela
    where p.cue = e.cue and p.role = p_rol and lower(p.login) = lower(p_rol || btrim(e.cue));
  if uid is null then raise exception 'La escuela no tiene una cuenta %', upper(p_rol); end if;
  perform public._restablecer_usuario(uid);
end $$;
revoke all on function public.escuela_reset_cuenta(bigint,text) from public, anon;
grant execute on function public.escuela_reset_cuenta(bigint,text) to authenticated;

create table public.eoe_pin_blanqueos (
  id bigint generated always as identity primary key,
  integrante_id bigint not null,
  escuela_id bigint not null references public.escuelas(id) on delete cascade,
  autor_id uuid not null,
  fecha timestamptz not null default now()
);
alter table public.eoe_pin_blanqueos enable row level security;
revoke all on public.eoe_pin_blanqueos from public, anon, authenticated;

create function public.eoe_pin_estado_distrital(p_integrantes bigint[])
returns table (integrante_id bigint, tiene_pin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital'
    or public.eff_uid() is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
  if p_integrantes is null or cardinality(p_integrantes) > 500 then raise exception 'Listado inválido'; end if;
  return query select e.id, p.integrante_id is not null from public.equipo_orientacion e
    left join public.eoe_pines p on p.integrante_id = e.id
    where e.id = any(p_integrantes) and public.can_see_escuela(e.escuela_id);
end $$;

create function public.eoe_pin_blanquear_distrital(p_escuela bigint, p_integrante bigint)
returns void language plpgsql security definer set search_path = public as $$
declare cuenta uuid; destinatario uuid;
begin
  if public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital'
    or public.eff_uid() is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
  if not public.can_see_escuela(p_escuela) then raise exception 'Sin permiso'; end if;
  perform 1 from public.equipo_orientacion where id = p_integrante and escuela_id = p_escuela for update;
  if not found then raise exception 'Integrante no disponible en esta escuela'; end if;
  delete from public.eoe_pines where integrante_id = p_integrante;
  if not found then raise exception 'El integrante no tiene un PIN configurado'; end if;
  insert into public.eoe_pin_blanqueos(integrante_id, escuela_id, autor_id)
    values (p_integrante, p_escuela, auth.uid());
  for destinatario in
    update public.eoe_pin_solicitudes set resuelto_en = now(), resuelto_por = auth.uid()
    where integrante_id = p_integrante and resuelto_en is null returning solicitante
  loop
    perform public._notificar(destinatario, 'PIN restablecido', 'Ya podés crear un nuevo PIN de validación.', '#/pin-validacion');
  end loop;
  select p.id into cuenta from public.profiles p join public.escuelas e on e.cue = p.cue
    where e.id = p_escuela and p.role = 'eoe' and lower(p.login) = lower('eoe' || btrim(e.cue));
  if cuenta is not null and cuenta is distinct from destinatario then
    perform public._notificar(cuenta, 'PIN restablecido', 'JD3 restableció un PIN de validación. El integrante puede crear uno nuevo.', '#/pin-validacion');
  end if;
end $$;
revoke all on function public.eoe_pin_estado_distrital(bigint[]), public.eoe_pin_blanquear_distrital(bigint,bigint) from public, anon;
grant execute on function public.eoe_pin_estado_distrital(bigint[]), public.eoe_pin_blanquear_distrital(bigint,bigint) to authenticated;

create or replace function public.eoe_pin_restablecer(p_solicitud bigint)
returns void language plpgsql security definer set search_path = public as $$
declare solicitud public.eoe_pin_solicitudes;
begin
  if public.app_role() is distinct from 'distrital' or public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select * into solicitud from public.eoe_pin_solicitudes where id = p_solicitud and resuelto_en is null;
  if not found then raise exception 'Solicitud no disponible'; end if;
  perform 1 from public.equipo_orientacion where id = solicitud.integrante_id for update;
  select * into solicitud from public.eoe_pin_solicitudes where id = p_solicitud and resuelto_en is null for update;
  if not found then raise exception 'Solicitud no disponible'; end if;
  delete from public.eoe_pines where integrante_id = solicitud.integrante_id;
  update public.eoe_pin_solicitudes set resuelto_en = now(), resuelto_por = public.eff_uid() where id = p_solicitud;
  perform public._notificar(solicitud.solicitante, 'PIN restablecido', 'Ya podés crear un nuevo PIN de validación.', '#/pin-validacion');
end $$;
