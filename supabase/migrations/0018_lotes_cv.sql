-- CV asignado a un lote: ese stock queda comprometido para la operación.
-- Cuando se carga la salida (egreso con su CP y el CV) baja lo comprometido.
alter table public.lotes add column if not exists cv text;

alter table public.movimientos_stock add column if not exists cv text;

-- Comprometido = stock de los lotes con CV, menos las salidas (egresos) cargadas con ese CV
create or replace view public.stock_comprometido as
with lotes_cv as (
  select l.planta_id, l.producto_id, l.cv,
         sum(greatest(coalesce((
           select sum(case when m.tipo = 'ingreso' then m.cantidad else -m.cantidad end)
           from public.movimientos_stock m where m.lote_id = l.id), 0), 0)) as tn
  from public.lotes l
  where l.cv is not null
  group by l.planta_id, l.producto_id, l.cv
),
salidas_cv as (
  select m.planta_id, m.producto_id, m.cv, sum(m.cantidad) as tn
  from public.movimientos_stock m
  where m.tipo = 'egreso' and m.cv is not null and m.lote_id is null
  group by m.planta_id, m.producto_id, m.cv
)
select c.planta_id, c.producto_id, sum(greatest(c.tn - coalesce(s.tn, 0), 0)) as toneladas_comprometidas
from lotes_cv c
left join salidas_cv s on s.planta_id = c.planta_id and s.producto_id = c.producto_id and s.cv = c.cv
group by c.planta_id, c.producto_id;
