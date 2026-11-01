-- Funciones auxiliares y políticas RLS por rol

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.app_cue() returns text
language sql stable security definer set search_path = public as $$
  select cue from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- admin, regional o distrital
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin','regional','distrital'), false)
$$;

create or replace function public.claves_asignadas() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c), '{}')
  from public.inspectores i, unnest(i.escuelas_asignadas) c
  where i.user_id = auth.uid()
$$;

create or replace function public.can_see_escuela(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_role()
    when 'admin' then true
    when 'regional' then true
    when 'distrital' then true
    when 'escolar' then exists (select 1 from public.escuelas e where e.id = eid and e.cue = public.app_cue())
    when 'areal' then exists (select 1 from public.escuelas e where e.id = eid and e.clave = any (public.claves_asignadas()))
    else false end
$$;

-- Egresante visible para la escuela de origen (CUE) o destino (clave), y para sus inspectores
create or replace function public.can_see_trayectoria(ocue text, oclave text, dclave text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_role()
    when 'admin' then true
    when 'regional' then true
    when 'distrital' then true
    when 'escolar' then ocue = public.app_cue()
      or dclave in (select e.clave from public.escuelas e where e.cue = public.app_cue())
    when 'areal' then oclave = any (public.claves_asignadas()) or dclave = any (public.claves_asignadas())
    else false end
$$;

alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.messages enable row level security;
alter table public.circuitos_electorales enable row level security;
alter table public.nudos enable row level security;
alter table public.catalogos enable row level security;
alter table public.escuelas enable row level security;
alter table public.inspectores enable row level security;
alter table public.egresantes enable row level security;
alter table public.intervenciones enable row level security;
alter table public.impersonaciones enable row level security;
alter table public.equipo_directivo enable row level security;
alter table public.equipo_orientacion enable row level security;
alter table public.referentes_esi enable row level security;
alter table public.planes_estudio enable row level security;
alter table public.planes_cursos enable row level security;
alter table public.turnos enable row level security;
alter table public.plantas enable row level security;
alter table public.planta_turnos enable row level security;
alter table public.planta_secciones enable row level security;
alter table public.carga_activa enable row level security;
alter table public.matricula_cargas enable row level security;
alter table public.matricula_datos enable row level security;
alter table public.ajustes enable row level security;
alter table public.agrupamientos_matricula enable row level security;
alter table public.agrupamiento_codigos enable row level security;

-- Perfiles: cada uno ve el suyo; admin ve y administra todos (alta/baja por RPC)
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_upd on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Bandeja: notificaciones propias; mensajes enviados o recibidos
create policy notif_own on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy msg_sel on public.messages for select to authenticated
  using (to_user_id = auth.uid() or from_user_id = auth.uid());
create policy msg_ins on public.messages for insert to authenticated
  with check (from_user_id = auth.uid());
create policy msg_upd on public.messages for update to authenticated
  using (to_user_id = auth.uid()) with check (to_user_id = auth.uid());

-- Catálogos y tablas de referencia: lectura para todos, escritura admin
do $$
declare t text;
begin
  foreach t in array array['circuitos_electorales','nudos','catalogos','planes_estudio','planes_cursos',
                           'turnos','agrupamientos_matricula','agrupamiento_codigos'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_adm', t);
  end loop;
end $$;

-- Escuelas
create policy escuelas_sel on public.escuelas for select to authenticated
  using (public.can_see_escuela(id));
create policy escuelas_upd on public.escuelas for update to authenticated
  using (public.can_see_escuela(id)) with check (public.can_see_escuela(id));
create policy escuelas_adm on public.escuelas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Inspectores
create policy insp_sel on public.inspectores for select to authenticated
  using (public.is_staff() or user_id = auth.uid());
create policy insp_adm on public.inspectores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Trayectorias
create policy egr_all on public.egresantes for all to authenticated
  using (public.can_see_trayectoria(origen_cue, origen_clave, destino_clave))
  with check (public.can_see_trayectoria(origen_cue, origen_clave, destino_clave));
create policy interv_all on public.intervenciones for all to authenticated
  using (exists (select 1 from public.egresantes g where g.id = egresante_id
    and public.can_see_trayectoria(g.origen_cue, g.origen_clave, g.destino_clave)))
  with check (exists (select 1 from public.egresantes g where g.id = egresante_id
    and public.can_see_trayectoria(g.origen_cue, g.origen_clave, g.destino_clave)));

create policy imp_adm on public.impersonaciones for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Fichas de la escuela
create policy ed_all on public.equipo_directivo for all to authenticated
  using (public.can_see_escuela(escuela_id)) with check (public.can_see_escuela(escuela_id));
create policy eoe_all on public.equipo_orientacion for all to authenticated
  using (public.can_see_escuela(escuela_id)) with check (public.can_see_escuela(escuela_id));
create policy esi_all on public.referentes_esi for all to authenticated
  using (public.can_see_escuela(escuela_id)) with check (public.can_see_escuela(escuela_id));

-- Planta y matrícula: lectura por alcance; las escrituras de la escuela van por RPC (security definer)
create policy plantas_sel on public.plantas for select to authenticated
  using (public.can_see_escuela(escuela_id));
create policy plantas_staff on public.plantas for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy planta_t_sel on public.planta_turnos for select to authenticated
  using (exists (select 1 from public.plantas p where p.id = planta_id and public.can_see_escuela(p.escuela_id)));
create policy planta_s_sel on public.planta_secciones for select to authenticated
  using (exists (select 1 from public.plantas p where p.id = planta_id and public.can_see_escuela(p.escuela_id)));

create policy carga_sel on public.carga_activa for select to authenticated using (true);
create policy carga_staff on public.carga_activa for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy mc_sel on public.matricula_cargas for select to authenticated
  using (public.can_see_escuela(escuela_id));
create policy md_sel on public.matricula_datos for select to authenticated
  using (exists (select 1 from public.matricula_cargas c where c.id = carga_id and public.can_see_escuela(c.escuela_id)));

create policy ajustes_sel on public.ajustes for select to authenticated using (true);
create policy ajustes_staff on public.ajustes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Marca la clave como cambiada (se llama tras auth.updateUser)
create or replace function public.clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change = false where id = auth.uid()
$$;

-- Resuelve el email sintético de Auth a partir del identificador de login
create or replace function public.auth_email(ident text) returns text
language sql immutable as $$
  select case when position('@' in ident) > 0 then lower(ident) else lower(ident) || '@dataescuela.app' end
$$;

revoke all on all functions in schema public from anon;
grant execute on function public.clave_cambiada() to authenticated;
grant execute on function public.app_role(), public.app_cue(), public.is_admin(), public.is_staff(),
  public.claves_asignadas(), public.can_see_escuela(bigint), public.can_see_trayectoria(text, text, text),
  public.auth_email(text) to authenticated;
