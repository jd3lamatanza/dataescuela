alter table public.turnos add column if not exists sigla text;
update public.turnos set sigla = case nombre
  when 'Mañana' then 'TM' when 'Tarde' then 'TT' when 'Vespertino' then 'TV'
  when 'Jornada Completa' then 'JC' when 'Jornada Extendida' then 'JE'
  else upper(left(regexp_replace(nombre, '[^A-Za-zÁÉÍÓÚÑáéíóúñ]', '', 'g'), 2)) end
where sigla is null;
alter table public.turnos alter column sigla set not null;
alter table public.turnos add constraint turnos_sigla_fmt check (sigla ~ '^[A-Z0-9]{2}$');
create unique index turnos_sigla_uk on public.turnos (sigla);
