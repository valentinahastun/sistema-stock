-- 0028: el CV de una CP sale de las compras que cubre, repartido.
-- Ej.: JIMENEZ ANDRES entregó 104,40 tn en 3 CP; en COMPRAS: 48 tn al CV 26-119
-- y el resto al 26-138. La CP 343 (38,38) quedó cubierta 13,62 por la compra
-- del 119 y le sobran 24,76, que son del 138. Ahora el comprometido de cada CV
-- se arma así:
-- * parte de la CP cubierta por una compra → el CV de esa compra;
-- * lo que no cubre ninguna compra → el CV que tenga la CP (se pone en Ingresos);
-- * si la CP ya bajó (caída, proceso), cada parte baja en la misma proporción.
-- El cruce ya no le copia a la CP el CV de la compra.

create or replace function public.conciliar_compras_cp(p_productor uuid default null, p_producto uuid default null)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  cp record;
  co record;
  v_cp_rem numeric;
  v_co_rem numeric;
  v_tn numeric;
  v_cv text;
  v_n int := 0;
begin
  for cp in
    select l.id, l.productor_id, l.producto_id, l.fecha_ingreso, l.cv, l.numero_cp, p.nombre as planta,
           l.cantidad_ingresada - coalesce((select sum(m.cantidad) from movimientos_stock m
                                            where m.lote_cp_id = l.id and m.tipo = 'cubierto'), 0) as rem
    from lotes l join plantas p on p.id = l.planta_id
    where (p_productor is null or l.productor_id = p_productor)
      and (p_producto is null or l.producto_id = p_producto)
      and l.proceso_id is null
      and l.created_at >= '2026-11-06'
      and not exists (select 1 from stock_compras s where s.lote_id = l.id)
      and not exists (select 1 from movimientos_stock d where d.descarte_generado_lote_id = l.id)
      and exists (select 1 from movimientos_stock i where i.lote_id = l.id and i.tipo = 'ingreso' and i.proceso_id is null)
    order by l.fecha_ingreso, l.created_at
  loop
    v_cp_rem := cp.rem;
    v_cv := cp.cv;
    continue when v_cp_rem <= 0.0005;
    -- Primero la compra con el mismo tonelaje que le queda a la CP; después, la más vieja
    for co in
      select x.lote_id, x.cv
      from (select s.lote_id, l.cv, l.fecha_ingreso, l.created_at,
                   (select coalesce(sum(case when m.tipo = 'ingreso' then m.cantidad else -m.cantidad end), 0)
                    from movimientos_stock m where m.lote_id = s.lote_id) as rem
            from stock_compras s join lotes l on l.id = s.lote_id
            where l.productor_id = cp.productor_id and l.producto_id = cp.producto_id
              and l.fecha_ingreso between cp.fecha_ingreso - 90 and cp.fecha_ingreso + 30) x
      where x.rem > 0.0005
      order by (abs(x.rem - v_cp_rem) <= 0.05) desc, x.fecha_ingreso, x.created_at
    loop
      exit when v_cp_rem <= 0.0005;
      select coalesce(sum(case when tipo = 'ingreso' then cantidad else -cantidad end), 0) into v_co_rem
      from movimientos_stock where lote_id = co.lote_id;
      continue when v_co_rem <= 0.0005;
      v_tn := round(least(v_cp_rem, v_co_rem), 3);
      insert into movimientos_stock (lote_id, tipo, cantidad, fecha, observaciones, lote_cp_id)
      values (co.lote_id, 'cubierto', v_tn, cp.fecha_ingreso,
              'Entró con CP ' || coalesce(cp.numero_cp, 's/n') || ' en ' || cp.planta, cp.id);
      v_cp_rem := v_cp_rem - v_tn;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

create or replace view public.stock_comprometido as
with mov as (
  select l.id, l.planta_id, l.producto_id, l.cv, l.cantidad_ingresada,
         coalesce((select sum(case when m.tipo = 'ingreso' then m.cantidad else -m.cantidad end)
                   from public.movimientos_stock m where m.lote_id = l.id), 0) as stock,
         coalesce((select sum(m.cantidad) from public.movimientos_stock m
                   where m.lote_cp_id = l.id and m.tipo = 'cubierto'), 0) as cubierto_tn
  from public.lotes l
),
partes as (
  -- parte de cada CP cubierta por una compra con CV
  select cp.planta_id, cp.producto_id, co.cv,
         m.cantidad * greatest(cp.stock, 0) / nullif(cp.cantidad_ingresada, 0) as tn
  from public.movimientos_stock m
  join mov cp on cp.id = m.lote_cp_id
  join public.lotes co on co.id = m.lote_id
  where m.tipo = 'cubierto' and co.cv is not null
  union all
  -- lo propio de cada lote con CV (entero, o lo que no cubre ninguna compra)
  select planta_id, producto_id, cv,
         case when cubierto_tn <= 0 then greatest(stock, 0)
              else greatest(stock, 0) * greatest(cantidad_ingresada - cubierto_tn, 0) / nullif(cantidad_ingresada, 0) end
  from mov
  where cv is not null
),
lotes_cv as (
  select planta_id, producto_id, cv, sum(tn) as tn
  from partes
  group by planta_id, producto_id, cv
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

-- JIMENEZ ANDRES: lo que sobra de la CP 343 (24,76) es del 26-138 (la compra de
-- esa parte no entró porque la operación ya figuraba cargada). Las CP 341 y 342
-- quedan enteras cubiertas por sus compras: su CV propio no hace falta.
update public.lotes l set cv = case when l.numero_cp = '00000-00000343' then 'CV 26-138' else null end
from public.productores pr
where pr.id = l.productor_id and pr.nombre = 'JIMENEZ ANDRES'
  and l.numero_cp in ('00000-00000341', '00000-00000342', '00000-00000343');

-- Cómo queda el comprometido por CV de JIMENEZ ANDRES
select co.cv, round(sum(m.cantidad), 2) as tn, 'cubierto por compra' as origen
from movimientos_stock m join lotes co on co.id = m.lote_id join lotes cp on cp.id = m.lote_cp_id
join productores pr on pr.id = cp.productor_id
where m.tipo = 'cubierto' and pr.nombre = 'JIMENEZ ANDRES'
group by co.cv
union all
select l.cv, round(l.cantidad_ingresada - coalesce((select sum(m.cantidad) from movimientos_stock m where m.lote_cp_id = l.id and m.tipo = 'cubierto'), 0), 2),
       'resto de la CP ' || l.numero_cp
from lotes l join productores pr on pr.id = l.productor_id
where pr.nombre = 'JIMENEZ ANDRES' and l.numero_cp is not null and l.cv is not null;
