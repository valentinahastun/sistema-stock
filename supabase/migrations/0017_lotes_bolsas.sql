-- Cantidad de bolsas de cada lote procesado: de 25 kg, de 50 kg y big bags
alter table public.lotes add column if not exists bolsas_25 integer check (bolsas_25 is null or bolsas_25 >= 0);
alter table public.lotes add column if not exists bolsas_50 integer check (bolsas_50 is null or bolsas_50 >= 0);
alter table public.lotes add column if not exists big_bags integer check (big_bags is null or big_bags >= 0);
