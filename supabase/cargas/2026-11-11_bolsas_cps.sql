-- Bolsas de las CP cargadas el 3 al 11/11 (leídas de Observaciones de cada CP).
-- Se busca cada CP por número (y fecha +-7 días, porque cada emisor tiene su
-- propia numeración). Al final muestra qué encontró para cada una.
with datos(cp, fecha, b25, b50, bb) as (
  values
    ('00000-00000288', date '2026-11-11', 1123, null, null),
    ('00000-00000286', date '2026-11-11', 1165, null, null),
    ('00000-00000283', date '2026-11-10', 1160, null, null),
    ('00000-00000284', date '2026-11-10', 1162, null, null),
    ('00000-00000281', date '2026-11-10', 1162, null, null),
    ('00000-00000279', date '2026-11-10', 1325, null, null),
    ('00000-00000280', date '2026-11-10', 1320, null, null),
    ('00000-00000091', date '2026-11-06', 1120, null, null),
    ('00000-00000092', date '2026-11-06', 1120, null, null),
    ('00000-00000234', date '2026-11-03', 600, null, null),
    ('00000-00000242', date '2026-11-10', 1326, null, null)
),
mov as (
  update public.movimientos_stock m
     set bolsas_25 = d.b25::int, bolsas_50 = d.b50::int, big_bags = d.bb::int
    from datos d
   where m.tipo in ('egreso', 'directo')
     and regexp_replace(coalesce(m.numero_cp, ''), '\D', '', 'g') = regexp_replace(d.cp, '\D', '', 'g')
     and abs(m.fecha - d.fecha) <= 7
  returning d.cp, m.tipo::text as donde, m.fecha, m.cantidad
),
lot as (
  update public.lotes l
     set bolsas_25 = d.b25::int, bolsas_50 = d.b50::int, big_bags = d.bb::int
    from datos d
   where regexp_replace(coalesce(l.numero_cp, ''), '\D', '', 'g') = regexp_replace(d.cp, '\D', '', 'g')
     and abs(l.fecha_ingreso - d.fecha) <= 7
     and l.bolsas_25 is null and l.bolsas_50 is null and l.big_bags is null
  returning d.cp, 'ingreso'::text as donde, l.fecha_ingreso as fecha, l.cantidad_ingresada as cantidad
)
select d.cp, coalesce(x.donde, 'NO ENCONTRADA') as donde, x.fecha, x.cantidad as tn,
       d.b25::int as bolsas_25, d.b50::int as bolsas_50, d.bb::int as big_bags
  from datos d
  left join (select * from mov union all select * from lot) x on x.cp = d.cp
 order by d.cp;
