alter table public.disposiciones
  add column escuela_base_fuera_distrital boolean not null default false,
  add constraint disposiciones_escuela_base_externa_valida check (
    not escuela_base_fuera_distrital or (escuela_base_id is null and btrim(escuela_base_nombre) <> '')
  );

create or replace function public.disposicion_validar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.disposiciones_permitido() then raise exception 'Sin permiso'; end if;
  select clave, coalesce(nullif(nombre, ''), concat_ws(' ', tipo, numero))
    into new.escuela_cubrir_clave, new.escuela_cubrir_nombre from public.escuelas where id = new.escuela_cubrir_id;
  if not found then raise exception 'Escuela a cubrir inexistente'; end if;
  if new.escuela_base_fuera_distrital then
    if new.escuela_base_id is not null or coalesce(btrim(new.escuela_base_nombre), '') = '' then
      raise exception 'Ingresá el nombre de la escuela fuera de la Distrital';
    end if;
    new.escuela_base_nombre := btrim(new.escuela_base_nombre);
    new.escuela_base_clave := coalesce(btrim(new.escuela_base_clave), '');
  elsif new.escuela_base_id is null then
    if tg_op = 'INSERT' or old.escuela_base_id is not null or old.escuela_base_fuera_distrital then
      raise exception 'Seleccioná una escuela base';
    end if;
    new.escuela_base_clave := old.escuela_base_clave;
    new.escuela_base_nombre := old.escuela_base_nombre;
  else
    select clave, coalesce(nullif(nombre, ''), concat_ws(' ', tipo, numero))
      into new.escuela_base_clave, new.escuela_base_nombre from public.escuelas where id = new.escuela_base_id;
    if not found then raise exception 'Escuela base inexistente'; end if;
  end if;
  if btrim(new.inspector) = '' or btrim(new.docente_nombre) = '' or new.docente_cuil !~ '^[0-9]+$'
    or new.email_jefatura !~* '^[^[:space:]@]+@abc\.gob\.ar$'
    or new.docente_email !~* '^[^[:space:]@]+@abc\.gob\.ar$'
    or new.cargo_cubrir not in ('Director','Vicedirector','Secretario','Prosecretario')
    or new.revista_cubrir not in ('Titular','Provisional','Suplente')
    or new.revista_base not in ('Titular','Provisional','Suplente')
    or btrim(new.numero_designacion) = '' or btrim(new.cargo_base) = '' then
    raise exception 'Completá los datos obligatorios con valores válidos';
  end if;
  select coalesce(nullif(name, ''), login) into new.usuario from public.profiles where id = public.eff_uid();
  new.actualizada := now();
  if tg_op = 'INSERT' then
    new.fecha_registro := now();
    new.estado := 'En proceso';
  else
    new.fecha_registro := old.fecha_registro;
  end if;
  return new;
end $$;
