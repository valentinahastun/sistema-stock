-- Arribos a depósito fiscal: la mercadería sale de planta (egreso / directo),
-- viaja a BsAs y la CPE confirmada en ARCA trae lo descargado. Se compara con
-- lo cargado: hasta 100 kg está bien; si es más, se reclama (al transportista
-- o a quien estuvo en la carga).
alter table public.movimientos_stock
  add column if not exists arribo_fecha date,
  add column if not exists cantidad_cargada_cp numeric(12, 3),     -- tn cargadas según la CPE confirmada
  add column if not exists arribo_estado text check (arribo_estado is null or arribo_estado in ('no_aplica')),
  add column if not exists reclamo_estado text check (reclamo_estado is null or reclamo_estado in ('reclamado', 'resuelto')),
  add column if not exists reclamo_a text check (reclamo_a is null or reclamo_a in ('transportista', 'carga')),
  add column if not exists reclamo_nota text;
