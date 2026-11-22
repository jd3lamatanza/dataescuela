create table public.proyectos_escolares (
  id uuid primary key default gen_random_uuid(),
  cue text not null check (length(btrim(cue)) > 0),
  tipo text not null check (tipo in (
    'Proyecto Institucional', 'Proyecto de Supervisión', 'Proyecto de Evaluación Institucional',
    'Plan de Prevención de Riesgos', 'Proyecto de Articulación', 'Proyecto de ESI',
    'Proyecto de Bibliotecas', 'Proyecto de Nudos', 'Plan de Concurrencia (Continuidad)',
    'Proyecto de Agrupamientos Flexibles', 'Plan de Contingencia',
    'Subproyecto Institucional de Artística', 'Subproyecto Institucional de Educación Física',
    'Subproyecto Institucional de Lenguas Extranjeras', 'Proyecto de Memoria Verdad y Justicia',
    'Proyecto de Malvinas Futuro', 'Proyecto de Leer en Comunidad', 'Proyecto de Niños Narradores', 'Otro'
  )),
  otro_tipo text,
  nombre text not null check (length(btrim(nombre)) between 1 and 255),
  bytes integer not null check (bytes between 1 and 5242880),
  drive_file_id text not null unique,
  created_at timestamptz not null default now(),
  check ((tipo = 'Otro' and otro_tipo is not null and length(btrim(otro_tipo)) between 1 and 150)
    or (tipo <> 'Otro' and otro_tipo is null))
);
create index proyectos_escolares_cue_fecha_idx on public.proyectos_escolares(cue, created_at desc, id desc);
alter table public.proyectos_escolares enable row level security;
revoke all on public.proyectos_escolares from public, anon, authenticated;
grant select on public.proyectos_escolares to authenticated;
grant all on public.proyectos_escolares to service_role;
create policy proyectos_escolares_sel on public.proyectos_escolares for select to authenticated
  using (public.app_role() = 'escolar' and cue = public.app_cue());

create table public.proyecto_carpetas (
  cue text primary key,
  clave text not null,
  drive_folder_id text,
  reserva uuid,
  reservada_hasta timestamptz
);
alter table public.proyecto_carpetas enable row level security;
revoke all on public.proyecto_carpetas from public, anon, authenticated;
grant all on public.proyecto_carpetas to service_role;

create function public.proyecto_carpeta_reservar(p_cue text, p_clave text, p_reserva uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare carpeta public.proyecto_carpetas;
begin
  insert into public.proyecto_carpetas(cue, clave) values (p_cue, p_clave) on conflict (cue) do nothing;
  select * into carpeta from public.proyecto_carpetas where cue = p_cue for update;
  if carpeta.clave <> p_clave then raise exception 'La clave provincial cambió; revisá la carpeta de proyectos.'; end if;
  if carpeta.drive_folder_id is not null then
    return jsonb_build_object('estado', 'lista', 'id', carpeta.drive_folder_id);
  end if;
  if carpeta.reservada_hasta > now() then return jsonb_build_object('estado', 'ocupada'); end if;
  update public.proyecto_carpetas set reserva = p_reserva, reservada_hasta = now() + interval '2 minutes' where cue = p_cue;
  return jsonb_build_object('estado', 'reservada');
end $$;

create function public.proyecto_carpeta_confirmar(p_cue text, p_reserva uuid, p_carpeta text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.proyecto_carpetas set drive_folder_id = p_carpeta, reserva = null, reservada_hasta = null
    where cue = p_cue and reserva = p_reserva and drive_folder_id is null;
  return found;
end $$;

create function public.proyecto_carpeta_liberar(p_cue text, p_reserva uuid) returns void
language sql security definer set search_path = public as $$
  update public.proyecto_carpetas set reserva = null, reservada_hasta = null where cue = p_cue and reserva = p_reserva
$$;
revoke all on function public.proyecto_carpeta_reservar(text,text,uuid), public.proyecto_carpeta_confirmar(text,uuid,text),
  public.proyecto_carpeta_liberar(text,uuid) from public, anon, authenticated;
grant execute on function public.proyecto_carpeta_reservar(text,text,uuid), public.proyecto_carpeta_confirmar(text,uuid,text),
  public.proyecto_carpeta_liberar(text,uuid) to service_role;

insert into public.ayuda_guias (id, modulo, titulo, descripcion, secciones, captura_drive, posicion)
select id, modulo, titulo, descripcion, secciones, captura_drive, posicion
from jsonb_to_recordset($ayuda_proyectos$[
  {
    "id": "mis-proyectos",
    "modulo": "mis-proyectos",
    "titulo": "Mis Proyectos",
    "descripcion": "Carga y consulta de los proyectos de la escuela.",
    "secciones": [
      {
        "titulo": "Subir un proyecto",
        "pasos": [
          "Abrí Mis Proyectos y elegí «Subir proyecto». Cargá únicamente los proyectos que correspondan al nivel y la modalidad de tu escuela.",
          "Seleccioná el tipo; si no está en la lista, elegí «Otro» y escribí el nombre del tipo. Seleccioná un archivo PDF de hasta 5 MB y tocá «Subir».",
          "Cada archivo se carga individualmente. Podés subir más de un proyecto del mismo tipo."
        ]
      },
      {
        "titulo": "Descargar o eliminar",
        "pasos": [
          "En el listado de la escuela elegí «Descargar» para guardar una copia del proyecto.",
          "Para quitarlo elegí «Eliminar» y confirmá. El archivo se elimina también de Google Drive y no se puede recuperar desde la aplicación."
        ]
      }
    ],
    "captura_drive": "1KFFJ24EmQDlgX3NTPw-1-uNICZs_KiOF",
    "posicion": 140
  }
]$ayuda_proyectos$::jsonb) as g(id text, modulo text, titulo text, descripcion text, secciones jsonb, captura_drive text, posicion integer)
on conflict (id) do nothing;
