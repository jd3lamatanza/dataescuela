-- La cuenta identifica todas las claves provinciales asociadas a su CUE.
create function public._clave_provincial_cue(p_cue text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select string_agg(distinct btrim(e.clave), ' / ' order by btrim(e.clave))
       from public.escuelas e where btrim(e.cue) = btrim(p_cue) and nullif(btrim(e.clave), '') is not null),
    'CUE ' || coalesce(nullif(btrim(p_cue), ''), 'sin asignar'))
$$;
revoke all on function public._clave_provincial_cue(text) from public, anon, authenticated;

create or replace function public._nombre_eoe_cue(p_cue text) returns text
language sql stable security definer set search_path = public as $$
  select 'EOE ' || public._clave_provincial_cue(p_cue)
$$;

create function public._nombre_escolar_eav_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('escolar', 'eav') then
    new.name := case when new.role = 'eav' then 'EAV ' else '' end || public._clave_provincial_cue(new.cue);
  end if;
  return new;
end $$;
revoke all on function public._nombre_escolar_eav_perfil() from public, anon, authenticated;
create trigger escolar_eav_nombre_perfil before insert or update of cue, role, name on public.profiles
  for each row execute function public._nombre_escolar_eav_perfil();

create or replace function public._nombre_eoe_escuela() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set name =
    case p.role when 'eoe' then 'EOE ' when 'eav' then 'EAV ' else '' end || public._clave_provincial_cue(p.cue)
    where p.role in ('escolar', 'eav', 'eoe')
      and (btrim(p.cue) = btrim(new.cue) or (tg_op = 'UPDATE' and btrim(p.cue) = btrim(old.cue)))
      and p.name is distinct from
        case p.role when 'eoe' then 'EOE ' when 'eav' then 'EAV ' else '' end || public._clave_provincial_cue(p.cue);
  return null;
end $$;

update public.profiles p set name =
  case when p.role = 'eav' then 'EAV ' else '' end || public._clave_provincial_cue(p.cue)
where p.role in ('escolar', 'eav')
  and p.name is distinct from
    case when p.role = 'eav' then 'EAV ' else '' end || public._clave_provincial_cue(p.cue);
