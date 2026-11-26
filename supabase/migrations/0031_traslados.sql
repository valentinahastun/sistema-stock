-- 0031: traslado de un lote de una planta a otra (ej.: el poroto negro de
-- ALINOA que va a LEGUCER a reprocesarse). No es una salida a una operación:
-- * en la planta de origen, el lote baja con un movimiento "traslado";
-- * en la de destino se crea un lote igual (productor, producto, estado, CV)
--   con su ingreso;
-- * el traslado apunta al lote nuevo: si se borra ese ingreso, el traslado se
--   borra solo y el lote vuelve a la planta de origen;
-- * el lote trasladado no se cruza con las compras (no es una CP nueva).

alter table public.movimientos_stock
  add column if not exists lote_destino_id uuid references public.lotes (id) on delete cascade;

do $$
declare v_tipos text;
begin
  select string_agg(quote_literal(t), ', ') into v_tipos
  from (select unnest(array['ingreso', 'descarte', 'egreso', 'directo', 'cubierto', 'traslado']) as t
        union select distinct tipo from public.movimientos_stock) x;
  alter table public.movimientos_stock drop constraint if exists movimientos_stock_tipo_check;
  execute format('alter table public.movimientos_stock add constraint movimientos_stock_tipo_check check (tipo in (%s))', v_tipos);
end $$;

create or replace view public.stock_lotes as
 SELECT l.id AS lote_id,
    l.planta_id,
    l.producto_id,
    l.productor_id,
    pr.nombre AS productor,
    l.numero_cp,
    l.estado,
    l.fecha_ingreso,
    l.cantidad_ingresada,
    l.caida_pct_estimada,
    ((COALESCE(sum(CASE WHEN (m.tipo = 'ingreso'::text) THEN m.cantidad ELSE (0)::numeric END), (0)::numeric)
      - COALESCE(sum(CASE WHEN (m.tipo = 'descarte'::text) THEN m.cantidad ELSE (0)::numeric END), (0)::numeric))
      - COALESCE(sum(CASE WHEN (m.tipo = ANY (ARRAY['egreso'::text, 'cubierto'::text, 'traslado'::text])) THEN m.cantidad ELSE (0)::numeric END), (0)::numeric)) AS stock_actual_tn
   FROM ((lotes l
     JOIN productores pr ON ((pr.id = l.productor_id)))
     LEFT JOIN movimientos_stock m ON ((m.lote_id = l.id)))
  GROUP BY l.id, l.planta_id, l.producto_id, l.productor_id, pr.nombre, l.numero_cp, l.estado, l.fecha_ingreso, l.cantidad_ingresada, l.caida_pct_estimada;

create or replace view public.stock_consolidado as
 WITH por_lote AS (
         SELECT l.planta_id,
            p.nombre AS planta,
            l.producto_id,
            pr.nombre AS producto,
            ((sum(CASE WHEN (m.tipo = 'ingreso'::text) THEN m.cantidad ELSE (0)::numeric END)
              - sum(CASE WHEN (m.tipo = 'descarte'::text) THEN m.cantidad ELSE (0)::numeric END))
              - sum(CASE WHEN (m.tipo = ANY (ARRAY['egreso'::text, 'cubierto'::text, 'traslado'::text])) THEN m.cantidad ELSE (0)::numeric END)) AS stock_tn
           FROM (((lotes l
             JOIN plantas p ON ((p.id = l.planta_id)))
             JOIN productos pr ON ((pr.id = l.producto_id)))
             LEFT JOIN movimientos_stock m ON ((m.lote_id = l.id)))
          GROUP BY l.planta_id, p.nombre, l.producto_id, pr.nombre
        ), egresos_generales AS (
         SELECT m.planta_id,
            p.nombre AS planta,
            m.producto_id,
            pr.nombre AS producto,
            (- sum(m.cantidad)) AS stock_tn
           FROM ((movimientos_stock m
             JOIN plantas p ON ((p.id = m.planta_id)))
             JOIN productos pr ON ((pr.id = m.producto_id)))
          WHERE ((m.lote_id IS NULL) AND (m.tipo = 'egreso'::text))
          GROUP BY m.planta_id, p.nombre, m.producto_id, pr.nombre
        )
 SELECT planta_id,
    planta,
    producto_id,
    producto,
    sum(stock_tn) AS stock_disponible_tn
   FROM ( SELECT por_lote.planta_id, por_lote.planta, por_lote.producto_id, por_lote.producto, por_lote.stock_tn
           FROM por_lote
        UNION ALL
         SELECT egresos_generales.planta_id, egresos_generales.planta, egresos_generales.producto_id,
            egresos_generales.producto, egresos_generales.stock_tn
           FROM egresos_generales) t
  GROUP BY planta_id, planta, producto_id, producto;

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
      and not exists (select 1 from movimientos_stock t where t.lote_destino_id = l.id and t.tipo = 'traslado')
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

select 'Traslados listos' as resultado;
