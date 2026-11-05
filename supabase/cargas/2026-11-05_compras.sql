-- Compras de Seguimiento COMEX > COMPRAS que todavía están en stock (05/11/2026)
-- * Las ya cargadas (26-131, 26-132, 26-140, 26-118, 26-102), Los Dos Ríos y Fracoga Negro no se cargan.
-- * Las que tienen CV quedan comprometidas para esa operación.
-- * Planta = productor, salvo Ind. Frig. del Norte Grande, que está en BIURRUM.

drop table if exists _compras;

begin;

-- Columna del CV del lote y stock comprometido por CV (migración 0018)
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

create temp table _compras (
  id uuid default gen_random_uuid(),
  fecha date, planta text, producto text, productor text, tn numeric(12, 3), cv text
);

insert into _compras (fecha, planta, producto, productor, tn, cv) values
  -- Con CV, todavía sin cargar
  ('2026-10-05', 'CAÑADA HUMEDA', 'Poroto Alubia', 'Cañada Humeda', 200, 'CV 26-124'),
  ('2026-10-19', 'CAÑADA HUMEDA', 'Poroto Alubia', 'Cañada Humeda', 40, 'CV 26-124'),
  ('2026-10-19', 'CAÑADA HUMEDA', 'Poroto Alubia', 'Cañada Humeda', 240, 'CV 26-135'),
  ('2026-10-08', 'BIURRUM', 'Poroto Cranberry', 'Industrias Frigoríficas del Norte Grande', 48, 'CV 26-128'),
  ('2026-10-08', 'BIURRUM', 'Poroto Cranberry', 'Industrias Frigoríficas del Norte Grande', 192, 'CV 26-134'),
  ('2026-10-19', 'FRANZINI', 'Poroto Alubia', 'Carlos A. Franzini e Hijos', 72, 'CV 26-136'),
  ('2026-10-21', 'BIURRUM', 'Poroto Colorado Light', 'Industrias Frigoríficas del Norte Grande', 96, 'CV 26-141'),
  ('2026-10-20', 'ZAZZARINI', 'Poroto Colorado Dark', 'Arrugado Zazarini', 120, 'CV 26-142'),
  -- Sin CV (stock libre)
  ('2026-10-09', 'BIURRUM', 'Poroto Colorado Light', 'Industrias Frigoríficas del Norte Grande', 120, null),
  ('2026-10-25', 'POROSEM', 'Poroto Colorado Dark', 'Porosem', 48, null),
  ('2026-10-25', 'POROSEM', 'Poroto Colorado Light', 'Porosem', 48, null),
  ('2026-10-18', 'FRANZINI', 'Poroto Cranberry', 'Carlos A. Franzini e Hijos', 72, null),
  ('2026-10-22', 'A CONFIRMAR', 'Poroto Mungo', 'A confirmar', 120, null);

-- Plantas y productores que faltan en los catálogos
insert into public.plantas (nombre)
select distinct c.planta from _compras c
where not exists (select 1 from public.plantas p where upper(trim(p.nombre)) = upper(trim(c.planta)));

insert into public.productores (nombre)
select distinct c.productor from _compras c
where not exists (select 1 from public.productores p where lower(trim(p.nombre)) = lower(trim(c.productor)));

do $$
declare v_faltan text;
begin
  select string_agg(distinct c.producto, ', ') into v_faltan from _compras c
  where not exists (select 1 from public.productos p where p.nombre = c.producto);
  if v_faltan is not null then raise exception 'No encontré estos productos: %', v_faltan; end if;
  if exists (select 1 from public.movimientos_stock where observaciones like '%Seguimiento COMEX > COMPRAS%') then
    raise exception 'Las compras ya estaban cargadas: no se cargan de nuevo';
  end if;
end $$;

insert into public.lotes (id, planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada, cv)
select c.id, pl.id, pr.id, pd.id, 'procesado', c.fecha, c.tn, c.cv
from _compras c
join public.plantas pl on upper(trim(pl.nombre)) = upper(trim(c.planta))
join public.productos pr on pr.nombre = c.producto
join public.productores pd on lower(trim(pd.nombre)) = lower(trim(c.productor));

insert into public.movimientos_stock (lote_id, tipo, cantidad, fecha, observaciones, planta_id, producto_id, productor_id)
select l.id, 'ingreso', l.cantidad_ingresada, l.fecha_ingreso,
       'Compra ' || to_char(l.fecha_ingreso, 'DD/MM/YYYY') || coalesce(' · ' || c.cv, ' · sin CV') || ' · Seguimiento COMEX > COMPRAS',
       l.planta_id, l.producto_id, l.productor_id
from _compras c join public.lotes l on l.id = c.id;

commit;

-- Resumen
select pl.nombre as planta, pr.nombre as producto, coalesce(l.cv, 'libre') as cv, sum(l.cantidad_ingresada) as tn
from public.lotes l
join public.plantas pl on pl.id = l.planta_id
join public.productos pr on pr.id = l.producto_id
where l.fecha_ingreso < date '2026-11-05'
group by 1, 2, 3 order by 1, 2, 3;
