create table public.contingencias (
  id bigint generated always as identity primary key,
  cue text not null check (length(trim(cue)) > 0),
  tipos text[] not null check (
    cardinality(tipos) > 0 and array_position(tipos, null) is null
    and tipos <@ array['Falta de Agua', 'Falta de Electricidad', 'Falta de Gas', 'Inclemencia Climática',
      'Riesgo Edilicio', 'Medida de Fuerza', 'Duelo', 'Otro']::text[]
  ),
  suspension text not null check (suspension in ('sin', 'parcial', 'total')),
  observaciones text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contingencias_cue_created_idx on public.contingencias (cue, created_at desc, id desc);

create table public.contingencia_turnos (
  contingencia_id bigint not null references public.contingencias(id) on delete cascade,
  turno_id bigint not null references public.turnos(id),
  primary key (contingencia_id, turno_id)
);

alter table public.contingencias enable row level security;
alter table public.contingencia_turnos enable row level security;
revoke all on public.contingencias, public.contingencia_turnos from public, anon, authenticated;
grant select on public.contingencias, public.contingencia_turnos to authenticated;

create policy contingencias_escolar_sel on public.contingencias for select to authenticated
  using (public.app_role() = 'escolar' and cue = public.app_cue());
create policy contingencia_turnos_escolar_sel on public.contingencia_turnos for select to authenticated
  using (exists (select 1 from public.contingencias c where c.id = contingencia_id));

create function public.contingencia_guardar(
  p_id bigint, p_tipos text[], p_suspension text, p_turnos bigint[], p_observaciones text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cue text := public.app_cue();
  v_id bigint;
begin
  if public.app_role() is distinct from 'escolar' or v_cue is null or trim(v_cue) = ''
    or not exists (select 1 from public.escuelas where cue = v_cue) then
    raise exception 'La cuenta no tiene permiso o escuela asociada';
  end if;
  if p_id is not null then
    select id into v_id from public.contingencias where id = p_id and cue = v_cue for update;
    if not found then raise exception 'Contingencia no encontrada o sin permiso'; end if;
  end if;
  if p_tipos is null or cardinality(p_tipos) = 0 or array_position(p_tipos, null) is not null
    or not p_tipos <@ array['Falta de Agua', 'Falta de Electricidad', 'Falta de Gas', 'Inclemencia Climática',
      'Riesgo Edilicio', 'Medida de Fuerza', 'Duelo', 'Otro']::text[]
    or cardinality(p_tipos) <> (select count(distinct t) from unnest(p_tipos) t) then
    raise exception 'Seleccioná al menos un tipo de contingencia válido';
  end if;
  if p_suspension is null or p_suspension not in ('sin', 'parcial', 'total') then
    raise exception 'Seleccioná una opción de suspensión válida';
  end if;
  if p_turnos is null or cardinality(p_turnos) = 0 or array_position(p_turnos, null) is not null
    or cardinality(p_turnos) <> (select count(distinct t) from unnest(p_turnos) t)
    or exists (
      select 1 from unnest(p_turnos) t(id)
      where not exists (
        select 1 from public.turnos turno where turno.id = t.id
          and (turno.activo or exists (
            select 1 from public.contingencia_turnos ct where ct.contingencia_id = v_id and ct.turno_id = turno.id
          ))
      )
    ) then
    raise exception 'Seleccioná al menos un turno válido';
  end if;
  if p_id is null then
    insert into public.contingencias(cue, tipos, suspension, observaciones)
      values (v_cue, p_tipos, p_suspension, coalesce(p_observaciones, '')) returning id into v_id;
  else
    update public.contingencias set tipos = p_tipos, suspension = p_suspension,
      observaciones = coalesce(p_observaciones, ''), updated_at = now() where id = v_id;
    delete from public.contingencia_turnos where contingencia_id = v_id;
  end if;
  insert into public.contingencia_turnos(contingencia_id, turno_id)
    select v_id, t from unnest(p_turnos) t;
  return v_id;
end $$;

revoke all on function public.contingencia_guardar(bigint, text[], text, bigint[], text) from public, anon;
grant execute on function public.contingencia_guardar(bigint, text[], text, bigint[], text) to authenticated;

insert into public.ayuda_guias (id, modulo, titulo, descripcion, secciones, captura_drive, posicion)
select id, modulo, titulo, descripcion, secciones, captura_drive, posicion
from jsonb_to_recordset($ayuda_contingencias$[
  {
    "id": "contingencias",
    "modulo": "contingencias",
    "titulo": "Contingencias",
    "descripcion": "Registro y edición de las contingencias de la escuela.",
    "secciones": [
      {
        "titulo": "Registrar una contingencia",
        "pasos": [
          "Abrí Contingencias y elegí «Nueva contingencia». Activá todos los tipos que correspondan.",
          "Seleccioná la opción de suspensión y marcá al menos un turno afectado. Agregá observaciones si necesitás aclarar algo.",
          "Tocá «Guardar». La contingencia aparecerá en el listado de tu escuela."
        ]
      },
      {
        "titulo": "Consultar y editar",
        "pasos": [
          "El listado muestra las contingencias de tu escuela, sus turnos, observaciones y fecha de registro. Usá Anterior y Siguiente cuando haya varias páginas.",
          "Elegí «Editar» en el registro que querés modificar, actualizá los datos y tocá «Guardar»."
        ]
      }
    ],
    "captura_drive": "1WEqZqNrj9DuEaDUJl2CRkjYbCQFrWC_4",
    "posicion": 130
  }
]$ayuda_contingencias$::jsonb) as g(id text, modulo text, titulo text, descripcion text, secciones jsonb, captura_drive text, posicion integer)
on conflict (id) do nothing;
