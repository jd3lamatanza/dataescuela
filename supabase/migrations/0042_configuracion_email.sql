create table public.configuracion_email (
  id boolean primary key default true check (id),
  salidas_destino text not null,
  sistema_remitente text not null,
  respuesta text not null,
  nombre_remitente text not null,
  updated_at timestamptz not null default now(),
  check (salidas_destino = trim(salidas_destino) and length(salidas_destino) <= 254 and salidas_destino ~ '^[^[:space:][:cntrl:]@<>]+@[^[:space:][:cntrl:]@<>]+\.[^[:space:][:cntrl:]@<>]+$'),
  check (sistema_remitente = trim(sistema_remitente) and length(sistema_remitente) <= 254 and sistema_remitente ~ '^[^[:space:][:cntrl:]@<>]+@[^[:space:][:cntrl:]@<>]+\.[^[:space:][:cntrl:]@<>]+$'),
  check (respuesta = trim(respuesta) and length(respuesta) <= 254 and respuesta ~ '^[^[:space:][:cntrl:]@<>]+@[^[:space:][:cntrl:]@<>]+\.[^[:space:][:cntrl:]@<>]+$'),
  check (nombre_remitente = trim(nombre_remitente) and length(nombre_remitente) between 1 and 120 and nombre_remitente !~ '[[:cntrl:]<>]')
);

alter table public.configuracion_email enable row level security;
create policy configuracion_email_distrital_select on public.configuracion_email for select to authenticated using (public.app_role() = 'distrital');
create policy configuracion_email_distrital_insert on public.configuracion_email for insert to authenticated with check (public.app_role() = 'distrital');
create policy configuracion_email_distrital_update on public.configuracion_email for update to authenticated using (public.app_role() = 'distrital') with check (public.app_role() = 'distrital');
grant select, insert, update on public.configuracion_email to authenticated;
