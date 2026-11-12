-- Caladas: calidad de cada camión mientras se carga una operación.
-- Un registro de calidad con número de CP es una calada de ese camión.
alter table public.registros_calidad
  add column if not exists numero_cp text,
  add column if not exists patente text;

create index if not exists registros_calidad_contrato_idx on public.registros_calidad (numero_contrato);
