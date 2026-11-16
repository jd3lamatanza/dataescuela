create table public.eav_preinscripciones (
  id bigint generated always as identity primary key,
  temporada integer not null,
  escuela_eav_id bigint not null references public.escuelas(id),
  dni text not null check (dni ~ '^[0-9]{7,8}$'),
  nombre text not null,
  nacimiento date not null,
  genero text not null check (genero in ('Varón', 'Mujer', 'No Binario')),
  escuela_actual_id bigint references public.escuelas(id),
  escuela_actual_otra text,
  domicilio text not null,
  responsable text not null,
  vinculo text not null check (vinculo in ('Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro')),
  telefono text not null,
  email text not null,
  creado_en timestamptz not null default now(),
  constraint eav_preinscripcion_escuela_actual check (
    (escuela_actual_id is not null and escuela_actual_otra is null) or
    (escuela_actual_id is null and nullif(btrim(escuela_actual_otra), '') is not null)
  ),
  unique (temporada, dni)
);

alter table public.eav_preinscripciones enable row level security;
revoke all on public.eav_preinscripciones from anon, authenticated;
create policy eav_preinscripciones_distrital on public.eav_preinscripciones for select to authenticated
  using (public.app_role() = 'distrital');
grant select on public.eav_preinscripciones to authenticated;

create table public.eav_preinscripcion_intentos (
  ip_hash text not null,
  creado_en timestamptz not null default now()
);
create index eav_preinscripcion_intentos_idx on public.eav_preinscripcion_intentos (ip_hash, creado_en);
alter table public.eav_preinscripcion_intentos enable row level security;
revoke all on public.eav_preinscripcion_intentos from public, anon, authenticated;

create function public.eav_preinscripcion_permitir(p_ip_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  if p_ip_hash is null or length(p_ip_hash) <> 64 then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  if (select count(*) from public.eav_preinscripcion_intentos where ip_hash = p_ip_hash and creado_en > now() - interval '1 hour') >= 15 then
    return false;
  end if;
  delete from public.eav_preinscripcion_intentos where creado_en < now() - interval '1 day';
  insert into public.eav_preinscripcion_intentos (ip_hash) values (p_ip_hash);
  return true;
end $$;

create function public.eav_preinscribir(
  p_escuela bigint, p_dni text, p_nombre text, p_nacimiento date, p_genero text,
  p_actual bigint, p_otra text, p_domicilio text, p_responsable text, p_vinculo text, p_telefono text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_temporada integer := extract(year from v_fecha)::integer + case when extract(month from v_fecha) = 1 then 0 else 1 end;
  v_cupos integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  if coalesce(p_dni, '') !~ '^[0-9]{7,8}$'
    or p_nacimiento is null or p_nacimiento > v_fecha
    or p_genero not in ('Varón', 'Mujer', 'No Binario') or p_genero is null
    or p_vinculo not in ('Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro') or p_vinculo is null
    or length(btrim(coalesce(p_nombre, ''))) not between 3 and 200
    or length(btrim(coalesce(p_domicilio, ''))) not between 3 and 200
    or length(btrim(coalesce(p_responsable, ''))) not between 3 and 200
    or btrim(coalesce(p_telefono, '')) !~ '^[+0-9 ()-]{6,40}$'
    or length(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')) < 6
    or btrim(coalesce(p_email, '')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or length(coalesce(p_email, '')) > 120
    or ((p_actual is null) = (nullif(btrim(coalesce(p_otra, '')), '') is null))
    or length(coalesce(p_otra, '')) > 200 then
    return 'invalido';
  end if;
  if p_actual is not null and not exists (select 1 from public.escuelas where id = p_actual) then return 'invalido'; end if;
  perform 1 from public.escuelas where id = p_escuela and eav = 'Sí' for update;
  if not found then return 'escuela'; end if;
  select cupos into v_cupos from public.eav_cupos where escuela_id = p_escuela for update;
  if not found then return 'sin_cupo'; end if;
  if exists (select 1 from public.eav_preinscripciones where temporada = v_temporada and dni = p_dni) then return 'duplicado'; end if;
  if v_cupos > 0 and (select count(*) from public.eav_preinscripciones where temporada = v_temporada and escuela_eav_id = p_escuela) >= v_cupos then return 'sin_cupo'; end if;
  begin
    insert into public.eav_preinscripciones (temporada, escuela_eav_id, dni, nombre, nacimiento, genero, escuela_actual_id, escuela_actual_otra, domicilio, responsable, vinculo, telefono, email)
    values (v_temporada, p_escuela, p_dni, btrim(p_nombre), p_nacimiento, p_genero, p_actual, nullif(btrim(p_otra), ''), btrim(p_domicilio), btrim(p_responsable), p_vinculo, btrim(p_telefono), lower(btrim(p_email)));
  exception when unique_violation then
    return 'duplicado';
  end;
  return 'ok';
end $$;

revoke all on function public.eav_preinscripcion_permitir(text) from public, anon, authenticated;
revoke all on function public.eav_preinscribir(bigint, text, text, date, text, bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.eav_preinscripcion_permitir(text) to service_role;
grant execute on function public.eav_preinscribir(bigint, text, text, date, text, bigint, text, text, text, text, text, text) to service_role;
