-- Cuenta eoe: lectura de los datos de su escuela (planta, matrícula, salidas, fichas) y edición solo del equipo de orientación.
-- No se modifica can_see_escuela: sus políticas también habilitan escritura y eoe no debe heredarla.

create or replace function public._eoe_escuela(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() = 'eoe' and exists (select 1 from public.escuelas e where e.id = eid and e.cue = public.app_cue())
$$;
revoke all on function public._eoe_escuela(bigint) from public, anon;
grant execute on function public._eoe_escuela(bigint) to authenticated;

create policy eoe_escuelas_sel on public.escuelas for select using (public._eoe_escuela(id));
create policy eoe_directivo_sel on public.equipo_directivo for select using (public._eoe_escuela(escuela_id));
create policy eoe_esi_sel on public.referentes_esi for select using (public._eoe_escuela(escuela_id));
create policy eoe_plantas_sel on public.plantas for select using (public._eoe_escuela(escuela_id));
create policy eoe_planta_turnos_sel on public.planta_turnos for select
  using (exists (select 1 from public.plantas p where p.id = planta_turnos.planta_id and public._eoe_escuela(p.escuela_id)));
create policy eoe_planta_secciones_sel on public.planta_secciones for select
  using (exists (select 1 from public.plantas p where p.id = planta_secciones.planta_id and public._eoe_escuela(p.escuela_id)));
create policy eoe_matricula_cargas_sel on public.matricula_cargas for select using (public._eoe_escuela(escuela_id));
create policy eoe_matricula_datos_sel on public.matricula_datos for select
  using (exists (select 1 from public.matricula_cargas c where c.id = matricula_datos.carga_id and public._eoe_escuela(c.escuela_id)));
create policy eoe_salidas_sel on public.salidas for select using (public.app_role() = 'eoe' and cue = public.app_cue());

-- Única escritura permitida: la ficha del equipo de orientación de su escuela
create policy eoe_cuenta_equipo_orientacion on public.equipo_orientacion for all
  using (public._eoe_escuela(escuela_id)) with check (public._eoe_escuela(escuela_id));
