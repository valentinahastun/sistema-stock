-- Cocción, hidratación y decisión de apto en los registros de calidad.
--
-- Ejecutar en Supabase > SQL Editor ANTES de publicar el cambio en la app
-- (si la app nueva sube primero, guardar calidad da error porque las
-- columnas todavía no existen).
--
-- Qué agrega a registros_calidad:
--   coccion_minutos            tiempo de cocción
--   coccion_resultado          'bien' o 'mal'
--   hidratacion_peso_seco      gramos antes del remojo
--   hidratacion_peso_hidratado gramos después del remojo
--   hidratacion_pct            % de agua absorbida (lo calcula la base)
--   apto                       true = apto, false = no apto, null = pendiente

alter table public.registros_calidad
  add column if not exists coccion_minutos numeric(6, 1),
  add column if not exists coccion_resultado text,
  add column if not exists hidratacion_peso_seco numeric(10, 2),
  add column if not exists hidratacion_peso_hidratado numeric(10, 2),
  add column if not exists apto boolean;

alter table public.registros_calidad
  drop constraint if exists registros_calidad_coccion_resultado_check;
alter table public.registros_calidad
  add constraint registros_calidad_coccion_resultado_check
  check (coccion_resultado is null or coccion_resultado in ('bien', 'mal'));

-- (peso hidratado - peso seco) / peso seco * 100
-- Ej.: 100 g secos que pesan 195 g hidratados = 95 %
alter table public.registros_calidad
  add column if not exists hidratacion_pct numeric(7, 2)
  generated always as (
    case
      when hidratacion_peso_seco > 0 and hidratacion_peso_hidratado is not null
      then round((hidratacion_peso_hidratado - hidratacion_peso_seco) / hidratacion_peso_seco * 100, 2)
    end
  ) stored;

comment on column public.registros_calidad.apto is
  'Decisión final del lote (cocción, hidratación y análisis). null = pendiente.';
