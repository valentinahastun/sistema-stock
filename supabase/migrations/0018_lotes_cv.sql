-- CV asignado a un lote: ese stock queda comprometido para la operación.
-- Cuando se carga la salida (egreso con su CP) baja el stock del lote y baja lo comprometido.
alter table public.lotes add column if not exists cv text;

create or replace view public.stock_comprometido as
select l.planta_id,
       l.producto_id,
       sum(greatest(coalesce((
         select sum(case when m.tipo = 'ingreso' then m.cantidad else -m.cantidad end)
         from public.movimientos_stock m where m.lote_id = l.id), 0), 0)) as toneladas_comprometidas
from public.lotes l
where l.cv is not null
group by l.planta_id, l.producto_id;
