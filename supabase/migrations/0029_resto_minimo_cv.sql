-- 0029: diferencia de balanza para menos. Si después de las salidas de un CV
-- en una planta/producto le quedan hasta 200 kg, no es stock real: se suman a
-- la última salida de ese CV (con una nota) y el CV queda en 0. Es la misma
-- regla que ya había para cuando la CP supera el stock por hasta 200 kg.

-- Comprometido por CV (lo mismo que stock_comprometido, pero sin sumar los CV)
create or replace view public.stock_comprometido_cv as
with mov as (
  select l.id, l.planta_id, l.producto_id, l.cv, l.cantidad_ingresada,
         coalesce((select sum(case when m.tipo = 'ingreso' then m.cantidad else -m.cantidad end)
                   from public.movimientos_stock m where m.lote_id = l.id), 0) as stock,
         coalesce((select sum(m.cantidad) from public.movimientos_stock m
                   where m.lote_cp_id = l.id and m.tipo = 'cubierto'), 0) as cubierto_tn
  from public.lotes l
),
partes as (
  select cp.planta_id, cp.producto_id, co.cv,
         m.cantidad * greatest(cp.stock, 0) / nullif(cp.cantidad_ingresada, 0) as tn
  from public.movimientos_stock m
  join mov cp on cp.id = m.lote_cp_id
  join public.lotes co on co.id = m.lote_id
  where m.tipo = 'cubierto' and co.cv is not null
  union all
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
select c.planta_id, c.producto_id, c.cv, c.tn as lotes_tn, coalesce(s.tn, 0) as salidas_tn,
       greatest(c.tn - coalesce(s.tn, 0), 0) as comprometido_tn
from lotes_cv c
left join salidas_cv s on s.planta_id = c.planta_id and s.producto_id = c.producto_id and s.cv = c.cv;

create or replace view public.stock_comprometido as
select planta_id, producto_id, sum(comprometido_tn) as toneladas_comprometidas
from public.stock_comprometido_cv
group by planta_id, producto_id;

-- Si a un CV le quedan entre 1 y 200 kg y ya tuvo salidas, se suman a su última salida.
-- Devuelve los kg que ajustó (0 si no hizo nada).
create or replace function public.ajustar_resto_cv(p_planta uuid, p_producto uuid, p_cv text)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_resto numeric;
  v_mov uuid;
begin
  select comprometido_tn into v_resto
  from stock_comprometido_cv
  where planta_id = p_planta and producto_id = p_producto and cv = p_cv and salidas_tn > 0;
  v_resto := round(coalesce(v_resto, 0), 3);
  if v_resto <= 0.0005 or v_resto > 0.2 then
    return 0;
  end if;
  select id into v_mov
  from movimientos_stock
  where tipo = 'egreso' and lote_id is null and planta_id = p_planta and producto_id = p_producto and cv = p_cv
  order by fecha desc, created_at desc
  limit 1;
  if v_mov is null then
    return 0;
  end if;
  update movimientos_stock
  set cantidad = cantidad + v_resto,
      observaciones = coalesce(observaciones || ' · ', '') ||
        'Diferencia de balanza: se descontaron también ' || round(v_resto * 1000) || ' kg que quedaban del ' || p_cv || '.'
  where id = v_mov;
  return round(v_resto * 1000);
end;
$$;
revoke all on function public.ajustar_resto_cv(uuid, uuid, text) from public;
grant execute on function public.ajustar_resto_cv(uuid, uuid, text) to authenticated;

-- Lo que ya quedó así (ej. ALINOA, 26-112): se ajusta ahora y se muestra qué ajustó
select pl.nombre as planta, p.nombre as producto, c.cv, round(c.comprometido_tn, 3) as quedaban_tn,
       public.ajustar_resto_cv(c.planta_id, c.producto_id, c.cv) as kg_ajustados
from (select * from public.stock_comprometido_cv
      where salidas_tn > 0 and comprometido_tn > 0.0005 and comprometido_tn <= 0.2) c
join public.plantas pl on pl.id = c.planta_id
join public.productos p on p.id = c.producto_id
order by 1, 2, 3;
