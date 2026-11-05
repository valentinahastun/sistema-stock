-- Stock inicial: los lotes de producto (no descarte) pasan a "natural" para poder cargarles el % de caída
update public.lotes l set estado = 'natural'
from public.productos p
where p.id = l.producto_id
  and p.nombre not ilike 'Descarte%'
  and l.fecha_ingreso = date '2026-11-05'
  and l.estado = 'procesado'
  and not exists (select 1 from public.movimientos_stock m where m.lote_id = l.id and m.tipo <> 'ingreso');
