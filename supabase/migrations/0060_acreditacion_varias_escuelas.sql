alter table public.acreditacion_personas add column cargos_busqueda text not null default '';
update public.acreditacion_personas set cargos_busqueda = cargo;

create function public.acreditacion_cargo_inicial() returns trigger
language plpgsql set search_path = public as $$
begin
  new.cargos_busqueda := concat_ws(' ', new.cargo,
    (select string_agg(a.cargo, ' ' order by a.orden) from public.acreditacion_escuelas_adicionales a where a.persona_id = new.id));
  return new;
end $$;
create trigger acreditacion_cargo_inicial before insert or update of cargo on public.acreditacion_personas
  for each row execute function public.acreditacion_cargo_inicial();

create table public.acreditacion_escuelas_adicionales (
  persona_id bigint not null references public.acreditacion_personas(id) on delete cascade,
  orden smallint not null check (orden between 2 and 4),
  cargo text not null check (length(btrim(cargo)) between 2 and 200),
  escuela_id bigint references public.escuelas(id),
  escuela_externa text,
  primary key (persona_id, orden),
  check ((escuela_id is not null and escuela_externa is null)
    or (escuela_id is null and escuela_externa is not null and length(btrim(escuela_externa)) between 2 and 200))
);
alter table public.acreditacion_escuelas_adicionales enable row level security;
revoke all on public.acreditacion_escuelas_adicionales from public, anon, authenticated;
grant select on public.acreditacion_escuelas_adicionales to authenticated;
create policy acreditacion_escuelas_adicionales_distrital on public.acreditacion_escuelas_adicionales
  for select to authenticated using (public.app_role() = 'distrital');

create function public.acreditacion_cargos_actualizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare persona bigint := coalesce(new.persona_id, old.persona_id);
begin
  if tg_op = 'UPDATE' and old.persona_id is distinct from new.persona_id then
    update public.acreditacion_personas p set cargos_busqueda = concat_ws(' ', p.cargo,
      (select string_agg(a.cargo, ' ' order by a.orden) from public.acreditacion_escuelas_adicionales a where a.persona_id = old.persona_id))
      where p.id = old.persona_id;
  end if;
  update public.acreditacion_personas p set cargos_busqueda = concat_ws(' ', p.cargo,
    (select string_agg(a.cargo, ' ' order by a.orden) from public.acreditacion_escuelas_adicionales a where a.persona_id = persona))
    where p.id = persona;
  return null;
end $$;
create trigger acreditacion_cargos_actualizar after insert or update or delete on public.acreditacion_escuelas_adicionales
  for each row execute function public.acreditacion_cargos_actualizar();

create function public.acreditacion_registrar_multi(
  p_evento uuid, p_nombre text, p_dni text, p_escuelas jsonb, p_email text, p_publico boolean
) returns text language plpgsql security definer set search_path = public as $$
declare item jsonb; escuela bigint; primera jsonb; resultado text; persona bigint; indice integer := 0;
begin
  if p_publico is null then return 'invalido'; end if;
  if p_publico then
    if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  elsif public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso';
  end if;
  if jsonb_typeof(p_escuelas) is distinct from 'array' then return 'invalido'; end if;
  if jsonb_array_length(p_escuelas) not between 1 and 4 then return 'invalido'; end if;
  for item in select value from jsonb_array_elements(p_escuelas) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'cargo') is distinct from 'string'
      or length(btrim(item->>'cargo')) not between 2 and 200 then return 'invalido'; end if;
    if jsonb_typeof(item->'escuela_id') = 'number' then
      if item->>'escuela_id' !~ '^[1-9][0-9]{0,15}$'
        or jsonb_typeof(item->'escuela_externa') is distinct from 'null' then return 'invalido'; end if;
      escuela := (item->>'escuela_id')::bigint;
      if not exists (select 1 from public.escuelas where id = escuela) then return 'invalido'; end if;
    elsif jsonb_typeof(item->'escuela_id') = 'null' then
      if not p_publico or jsonb_typeof(item->'escuela_externa') is distinct from 'string'
        or length(btrim(item->>'escuela_externa')) not between 2 and 200 then return 'invalido'; end if;
    else return 'invalido';
    end if;
  end loop;
  primera := p_escuelas->0;
  if jsonb_typeof(primera->'escuela_id') = 'null' then
    resultado := public.acreditacion_registrar_externa(p_evento, p_nombre, p_dni, primera->>'cargo', primera->>'escuela_externa', p_email);
  else
    resultado := public.acreditacion_registrar(p_evento, p_nombre, p_dni, primera->>'cargo', (primera->>'escuela_id')::bigint, p_email, p_publico);
  end if;
  if resultado <> 'ok' then return resultado; end if;
  select id into strict persona from public.acreditacion_personas where evento_id = p_evento and dni = p_dni;
  for item in select value from jsonb_array_elements(p_escuelas) loop
    indice := indice + 1;
    if indice > 1 then
      insert into public.acreditacion_escuelas_adicionales(persona_id, orden, cargo, escuela_id, escuela_externa)
      values (persona, indice, btrim(item->>'cargo'), (item->>'escuela_id')::bigint,
        case when jsonb_typeof(item->'escuela_id') = 'null' then btrim(item->>'escuela_externa') else null end);
    end if;
  end loop;
  return 'ok';
end $$;
revoke all on function public.acreditacion_registrar_multi(uuid, text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.acreditacion_registrar_multi(uuid, text, text, jsonb, text, boolean) to authenticated, service_role;
