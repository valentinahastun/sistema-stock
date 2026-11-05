-- Quién controló la carga (la persona que mandamos a la carga de los camiones)
alter table public.movimientos_stock add column if not exists controlo_carga text;
