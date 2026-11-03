-- Cada directivo EAV enviado (o reenviado) pendiente de aprobación genera una alerta a los distritales
create or replace function public.eav_directivo_guardar(
  p_nombre text, p_cuil text, p_nacimiento date, p_cargo text, p_pat text, p_pid text, p_email text, p_tel text, p_domicilio text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.escuelas; d public.eav_directivos; v_id bigint; v_pend bigint; v_esc text;
begin
  if public.app_role() is distinct from 'escolar' then raise exception 'Solo las escuelas cargan el directivo de la EAV'; end if;
  select * into e from public.escuelas where cue = public.app_cue() order by id limit 1;
  if not found then raise exception 'No se encontró la escuela de tu usuario'; end if;
  if e.eav is distinct from 'Sí' then raise exception 'Activá primero la opción de escuela de verano'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 or length(p_nombre) > 150 then raise exception 'Ingresá el nombre completo'; end if;
  if coalesce(p_cuil, '') !~ '^[0-9]{11}$' then raise exception 'El CUIL debe tener 11 números'; end if;
  if p_nacimiento is null or p_nacimiento >= current_date or p_nacimiento < date '1930-01-01' then raise exception 'Fecha de nacimiento inválida'; end if;
  if length(trim(coalesce(p_cargo, ''))) < 2 or length(p_cargo) > 150 then raise exception 'Ingresá el cargo base'; end if;
  if length(coalesce(p_pat, '')) > 100 or length(coalesce(p_pid, '')) > 100 then raise exception 'PAT o PID demasiado largo'; end if;
  if lower(trim(coalesce(p_email, ''))) !~ '^[a-z0-9._%+-]+@abc\.gob\.ar$' then raise exception 'El email debe ser @abc.gob.ar'; end if;
  if coalesce(p_tel, '') !~ '^[0-9]{6,15}$' then raise exception 'El teléfono debe tener solo números (6 a 15)'; end if;
  if length(trim(coalesce(p_domicilio, ''))) < 3 or length(p_domicilio) > 250 then raise exception 'Ingresá el domicilio'; end if;

  select * into d from public.eav_directivos where cue = e.cue;
  v_pend := (select id from public.eav_estados where nombre = 'Pendiente Aprobación');
  if found then
    if not public.eav_directivo_editable(d.id) then raise exception 'El directivo está aprobado y no se puede modificar'; end if;
    update public.eav_directivos set nombre = trim(p_nombre), cuil = p_cuil, fecha_nacimiento = p_nacimiento, cargo_base = trim(p_cargo),
      pat = nullif(trim(p_pat), ''), pid = nullif(trim(p_pid), ''), email = lower(trim(p_email)), telefono = p_tel, domicilio = trim(p_domicilio),
      estado_id = v_pend, updated_at = now() where id = d.id;
    v_id := d.id;
    delete from public.notifications where url = '/eav?dir=' || v_id;
  else
  insert into public.eav_directivos (cue, clave, user_id, nombre, cuil, fecha_nacimiento, cargo_base, pat, pid, email, telefono, domicilio, estado_id)
  values (e.cue, e.clave, public.eff_uid(), trim(p_nombre), p_cuil, p_nacimiento, trim(p_cargo), nullif(trim(p_pat), ''), nullif(trim(p_pid), ''),
          lower(trim(p_email)), p_tel, trim(p_domicilio), v_pend)
  returning id into v_id;
  end if;
  v_esc := trim(concat_ws(' ', e.tipo, e.numero::text, e.nombre));
  insert into public.notifications (user_id, type, title, body, url)
  select p.id, 'info', 'Directivo de EAV pendiente de aprobación', coalesce(nullif(v_esc, ''), e.clave) || ': ' || trim(p_nombre), '/eav?dir=' || v_id
  from public.profiles p where p.role = 'distrital' and p.active;
  return v_id;
end $$;
