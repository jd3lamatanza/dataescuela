-- Los indicadores se almacenan por clave provincial; la cuenta escolar accede
-- únicamente a las claves de establecimientos asociados a su CUE efectivo.
do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'estadistica_matricula_pba',
    'estadistica_fichas_inscripcion',
    'estadistica_salidas_sin_ingreso',
    'estadistica_matricula_sin_cierre',
    'estadistica_boletin_digital',
    'estadistica_asistencia',
    'estadistica_desempeno'
  ] loop
    execute format(
      'create policy estadistica_escolar_select on public.%I for select to authenticated using (
        public.app_role() = ''escolar''
        and exists (
          select 1 from public.escuelas e
          where e.clave = %I.clave and e.cue = public.app_cue()
        )
      )', tabla, tabla
    );
  end loop;
end $$;
