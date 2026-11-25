create or replace function public.eoe_drive_archivo(p_tipo text, p_archivo uuid, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_referencia uuid; archivo text; carpeta text;
begin
  if p_tipo = 'legajo' then
    select a.legajo_id, a.drive_file_id into v_referencia, archivo from public.eoe_legajo_archivos a where a.id = p_archivo;
  elsif p_tipo = 'solicitud' then
    select a.solicitud_id, a.drive_file_id into v_referencia, archivo from public.eoe_legajo_probanzas a where a.id = p_archivo;
  end if;
  if v_referencia is null or public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not public._eoe_drive_permitido_actor(p_tipo, v_referencia, p_token, auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, false) then raise exception 'Archivo no disponible'; end if;
  select c.drive_folder_id into carpeta from public.eoe_drive_carpetas c where c.tipo = p_tipo and c.referencia = v_referencia;
  if carpeta is null then raise exception 'Carpeta no disponible'; end if;
  return jsonb_build_object('referencia', v_referencia, 'drive_file_id', archivo, 'carpeta_id', carpeta);
end $$;
