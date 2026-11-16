alter table public.acreditacion_personas alter column escuela_id drop not null;
alter table public.acreditacion_personas add column escuela_externa text;
alter table public.acreditacion_personas add constraint acreditacion_escuela_unica check (
  (escuela_id is not null and escuela_externa is null)
  or (escuela_id is null and escuela_externa is not null and length(btrim(escuela_externa)) between 2 and 200)
);

create function public.acreditacion_registrar_externa(
  p_evento uuid, p_nombre text, p_dni text, p_cargo text, p_escuela_externa text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_evento for update;
  if not found or v_estado <> 'activo' then return 'cerrado'; end if;
  if coalesce(p_dni, '') !~ '^[0-9]{7,8}$'
     or length(btrim(coalesce(p_nombre, ''))) not between 3 and 200
     or length(btrim(coalesce(p_cargo, ''))) not between 2 and 200
     or length(btrim(coalesce(p_escuela_externa, ''))) not between 2 and 200
     or length(coalesce(p_email, '')) > 254
     or btrim(coalesce(p_email, '')) !~* '^[a-z0-9._%+-]+@abc[.]gob[.]ar$' then return 'invalido'; end if;
  begin
    insert into public.acreditacion_personas(evento_id, nombre, dni, cargo, escuela_externa, email)
    values (p_evento, btrim(p_nombre), p_dni, btrim(p_cargo), btrim(p_escuela_externa), lower(btrim(p_email)));
  exception when unique_violation then return 'duplicado';
  end;
  return 'ok';
end $$;

revoke all on function public.acreditacion_registrar_externa(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.acreditacion_registrar_externa(uuid, text, text, text, text, text) to service_role;
