-- Roles eav (Escuela de Verano) y eoe (Equipo de Orientación): una cuenta de cada rol por escuela.
-- Usuario: eav{cue} / eoe{cue}. Clave inicial 12345678 con cambio obligatorio.
-- eav se activa cuando la escuela tiene Escuela de Verano habilitada; eoe cuando tiene cargado el equipo de orientación.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','regional','distrital','areal','escolar','eav','eoe'));

create function public._cuenta_escuela_habilitada(p_escuela bigint, p_rol text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_rol
    when 'eav' then exists (select 1 from public.escuelas e where e.id = p_escuela and e.eav = 'Sí')
    when 'eoe' then exists (select 1 from public.equipo_orientacion q where q.escuela_id = p_escuela and q.activo)
    else false end
$$;

-- Crea las cuentas que falten y alinea el estado activo; no hace nada si la escuela ya no existe.
create function public._cuentas_escuela_sincronizar(p_escuela bigint) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare esc record; rol text; uid uuid; habilitada boolean; ident text;
begin
  select id, cue, coalesce(nullif(trim(nombre), ''), cue) as nombre into esc from public.escuelas where id = p_escuela;
  if not found or coalesce(trim(esc.cue), '') = '' then return; end if;
  foreach rol in array array['eav', 'eoe'] loop
    ident := rol || trim(esc.cue);
    habilitada := public._cuenta_escuela_habilitada(esc.id, rol);
    select id into uid from public.profiles where lower(login) = lower(ident);
    if uid is null then
      uid := gen_random_uuid();
      perform public._crear_auth(uid, public.auth_email(ident), '12345678');
      insert into public.profiles (id, login, name, role, cue, active, must_change)
      values (uid, ident, (case rol when 'eav' then 'Escuela de Verano · ' else 'Equipo de Orientación · ' end) || esc.nombre,
        rol, trim(esc.cue), habilitada, true);
    else
      update public.profiles set active = habilitada where id = uid and role = rol and active is distinct from habilitada;
      if not habilitada then delete from auth.sessions where user_id = uid; end if;
    end if;
  end loop;
end $$;

create function public._trg_escuelas_cuentas() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if tg_op = 'DELETE' then
    delete from auth.users where id in (select id from public.profiles where role in ('eav', 'eoe') and cue = old.cue);
    return old;
  end if;
  perform public._cuentas_escuela_sincronizar(new.id);
  return new;
end $$;

create trigger escuelas_cuentas_alta after insert or update of eav, cue on public.escuelas
  for each row execute function public._trg_escuelas_cuentas();
create trigger escuelas_cuentas_baja after delete on public.escuelas
  for each row execute function public._trg_escuelas_cuentas();

create function public._trg_equipo_orientacion_cuentas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then perform public._cuentas_escuela_sincronizar(old.escuela_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.escuela_id is distinct from old.escuela_id) then
    perform public._cuentas_escuela_sincronizar(new.escuela_id);
  end if;
  return null;
end $$;

create trigger equipo_orientacion_cuentas after insert or update of escuela_id, activo or delete on public.equipo_orientacion
  for each row execute function public._trg_equipo_orientacion_cuentas();

revoke all on function public._cuenta_escuela_habilitada(bigint, text), public._cuentas_escuela_sincronizar(bigint),
  public._trg_escuelas_cuentas(), public._trg_equipo_orientacion_cuentas() from public, anon, authenticated;

-- El estado de estas cuentas depende de la escuela: no se bloquean ni activan a mano.
create or replace function public.usuario_activo(p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) or p_id = auth.uid() then raise exception 'Sin permiso'; end if;
  if r in ('eav', 'eoe') then raise exception 'El estado de esta cuenta depende de la escuela'; end if;
  update public.profiles set active = p_activo where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- Datos mínimos de la escuela propia para las cuentas eav y eoe (sin acceso a las tablas de la escuela).
create function public.mi_escuela_cuenta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rol text := public.app_role(); esc record;
begin
  if rol not in ('eav', 'eoe') then raise exception 'Sin permiso'; end if;
  select e.id, e.cue, e.nombre, e.nivel, e.modalidad, e.localidad, (e.eav = 'Sí') as eav into esc
  from public.escuelas e where e.cue = public.app_cue();
  if not found then return null; end if;
  return jsonb_build_object('id', esc.id, 'cue', esc.cue, 'nombre', esc.nombre, 'nivel', esc.nivel,
    'modalidad', esc.modalidad, 'localidad', esc.localidad, 'eav', esc.eav,
    'integrantes', (select count(*) from public.equipo_orientacion q where q.escuela_id = esc.id and q.activo));
end $$;
revoke all on function public.mi_escuela_cuenta() from public, anon;
grant execute on function public.mi_escuela_cuenta() to authenticated;

-- Cuentas de las escuelas existentes
do $$ declare e bigint; begin
  for e in select id from public.escuelas order by id loop perform public._cuentas_escuela_sincronizar(e); end loop;
end $$;
