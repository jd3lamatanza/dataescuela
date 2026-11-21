-- Trazabilidad de las filas importadas, sin exponer los datos de origen a la aplicación.
create table if not exists public.salidas_importaciones (
  archivo_sha256 text not null,
  fila integer not null check (fila >= 2),
  salida_id bigint not null unique references public.salidas(id) on delete cascade,
  primary key (archivo_sha256, fila)
);

alter table public.salidas_importaciones enable row level security;
revoke all on public.salidas_importaciones from public, anon, authenticated, service_role;
