create table public.eav_cupos (
  escuela_id bigint primary key references public.escuelas(id) on delete cascade,
  cupos integer not null check (cupos >= 0),
  actualizado_en timestamptz not null default now()
);

alter table public.eav_cupos enable row level security;
create policy eav_cupos_distrital_sel on public.eav_cupos for select to authenticated
  using (public.app_role() = 'distrital');
revoke all on public.eav_cupos from anon, authenticated;
grant select on public.eav_cupos to authenticated;

create function public.eav_asignar_cupos(p_escuela bigint, p_cupos integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then
    raise exception 'Solo el rol distrital puede asignar cupos';
  end if;
  if p_cupos is null or p_cupos < 0 then
    raise exception 'Los cupos deben ser un número entero mayor o igual a cero';
  end if;
  if not exists (select 1 from public.escuelas where id = p_escuela) then
    raise exception 'La escuela no existe';
  end if;
  insert into public.eav_cupos (escuela_id, cupos)
    values (p_escuela, p_cupos)
    on conflict (escuela_id) do update set cupos = excluded.cupos, actualizado_en = now();
end
$$;

revoke all on function public.eav_asignar_cupos(bigint, integer) from public, anon, authenticated;
grant execute on function public.eav_asignar_cupos(bigint, integer) to authenticated;
