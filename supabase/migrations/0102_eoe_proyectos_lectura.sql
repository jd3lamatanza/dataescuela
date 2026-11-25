-- El EOE puede consultar los proyectos del mismo CUE, sin permisos de escritura.
create policy proyectos_eoe_sel on public.proyectos_escolares for select to authenticated
  using (public.app_role() = 'eoe' and cue = public.app_cue());
