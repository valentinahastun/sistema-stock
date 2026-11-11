-- Bolsas de cada egreso / movimiento directo (se leen de "Observaciones"
-- de la CP: "1162 bolsas x 25 kg"). Los ingresos las guardan en el lote,
-- que ya tiene estas columnas (0017).
alter table public.movimientos_stock
  add column if not exists bolsas_25 integer check (bolsas_25 is null or bolsas_25 >= 0),
  add column if not exists bolsas_50 integer check (bolsas_50 is null or bolsas_50 >= 0),
  add column if not exists big_bags integer check (big_bags is null or big_bags >= 0);
