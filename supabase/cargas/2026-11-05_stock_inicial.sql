-- Carga inicial de stock (planilla Proceso_Stock, corte 05/11/2026)
-- * Stock exportable (columna K) y descarte en stock (columna O), en toneladas.
-- * Lotes sin productor en la planilla quedan con productor "-".
-- * Legucer: en observaciones va el N° de proceso y el CV.
-- Si algo no coincide con los catálogos, no carga nada y avisa.

begin;

create temp table _carga (
  id uuid default gen_random_uuid(),
  planta text, producto text, productor text, estado text, tn numeric(12, 3), obs text
);

insert into _carga (planta, producto, productor, estado, tn, obs) values
  -- Stock exportable
  ('LEGUCER', 'Poroto Negro', '-', 'procesado', 0.525,
     'Stock inicial 05/11/2026 · Proceso 47 · CV 26-044, 26-057, 26-062 A, 26-062 B / Proceso 46 · CV 26-071, 26-081 B, 26-088 A / Proceso 64'),
  ('LEGUCER', 'Poroto Colorado Dark', 'Decrops', 'procesado', 27.750, 'Stock inicial 05/11/2026 · Proceso 62'),
  ('LEGUCER', 'Poroto Colorado Dark', 'La Bajada', 'procesado', 0.030, 'Stock inicial 05/11/2026 · Proceso 71 · CV 26-099'),
  ('CABALLERO LUIS ALBERTO', 'Poroto Cranberry', 'El Valle', 'procesado', 0.865, 'Stock inicial 05/11/2026 · CV 26-073'),
  ('CABALLERO LUIS ALBERTO', 'Poroto Alubia', 'Giacopo Bruno', 'procesado', 18.200, 'Stock inicial 05/11/2026 · CV 26-080 A'),
  ('CABALLERO LUIS ALBERTO', 'Poroto Alubia', 'Expo Gram', 'procesado', 59.525, 'Stock inicial 05/11/2026 · CV 26-118'),
  ('CABALLERO LUIS ALBERTO', 'Poroto Alubia', 'Los Dos Rios', 'procesado', 12.275, 'Stock inicial 05/11/2026 · CV 26-137'),
  -- Descarte en stock
  ('LEGUCER', 'Descarte Negro', '-', 'natural', 0.837, 'Descarte inicial 05/11/2026 · Proceso 46 · CV 26-071, 26-081 B, 26-088 A'),
  ('LEGUCER', 'Descarte Negro', '-', 'natural', 5.874, 'Descarte inicial 05/11/2026 · Proceso 64'),
  ('LEGUCER', 'Descarte Mung', '-', 'natural', 0.566, 'Descarte inicial 05/11/2026 · Proceso 57'),
  ('LEGUCER', 'Descarte Dark', 'Decrops', 'natural', 1.476, 'Descarte inicial 05/11/2026 · Proceso 62'),
  ('LEGUCER', 'Descarte Dark', 'La Bajada', 'natural', 14.610, 'Descarte inicial 05/11/2026 · Proceso 71 · CV 26-099'),
  ('LEGUCER', 'Descarte Cranberry', '-', 'natural', 10.255, 'Descarte inicial 05/11/2026 · Proceso 67 · CV 26-096, 26-104, 26-132'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Dark', 'CEF', 'natural', 6.210, 'Descarte inicial 05/11/2026 · CV 26-093'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Cranberry', 'El Valle', 'natural', 22.275, 'Descarte inicial 05/11/2026 · CV 26-073'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Alubia', 'Flores Enrique', 'natural', 18.010, 'Descarte inicial 05/11/2026 · CV 26-086'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Alubia', 'Expo Gram', 'natural', 11.380, 'Descarte inicial 05/11/2026 · CV 26-118'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Alubia', 'Baya Casal', 'natural', 43.715, 'Descarte inicial 05/11/2026 · CV 26-095, 26-103'),
  ('CABALLERO LUIS ALBERTO', 'Descarte Alubia', 'Los Dos Rios', 'natural', 6.505, 'Descarte inicial 05/11/2026 · CV 26-137'),
  ('ALIMENTOS TROPICALES', 'Descarte Alubia', 'Palacios Pantaleon', 'natural', 1.230, 'Descarte inicial 05/11/2026 · CV 26-092'),
  ('FRACOGA', 'Descarte Negro', 'Decrops', 'natural', 1.280, 'Descarte inicial 05/11/2026 · CV 26-088 B');

-- Productores que faltan en el catálogo
insert into public.productores (nombre)
select distinct c.productor from _carga c
where not exists (select 1 from public.productores p where lower(trim(p.nombre)) = lower(trim(c.productor)));

-- Todo tiene que existir en los catálogos (si no, se cancela)
do $$
declare v_faltan text;
begin
  select string_agg(distinct c.planta || ' / ' || c.producto, ', ') into v_faltan
  from _carga c
  where not exists (select 1 from public.plantas p where p.nombre = c.planta)
     or not exists (select 1 from public.productos p where p.nombre = c.producto);
  if v_faltan is not null then raise exception 'No encontré en los catálogos: %', v_faltan; end if;
  if exists (select 1 from public.lotes) then raise exception 'Ya hay lotes cargados: no se hace la carga inicial'; end if;
end $$;

insert into public.lotes (id, planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada)
select c.id, pl.id, pr.id, pd.id, c.estado, date '2026-11-05', c.tn
from _carga c
join public.plantas pl on pl.nombre = c.planta
join public.productos pr on pr.nombre = c.producto
join public.productores pd on lower(trim(pd.nombre)) = lower(trim(c.productor));

insert into public.movimientos_stock (lote_id, tipo, cantidad, fecha, observaciones, planta_id, producto_id, productor_id)
select l.id, 'ingreso', l.cantidad_ingresada, date '2026-11-05', c.obs, l.planta_id, l.producto_id, l.productor_id
from _carga c join public.lotes l on l.id = c.id;

commit;

-- Resumen de lo cargado
select pl.nombre as planta, pr.nombre as producto, count(*) as lotes, sum(l.cantidad_ingresada) as tn
from public.lotes l
join public.plantas pl on pl.id = l.planta_id
join public.productos pr on pr.id = l.producto_id
group by 1, 2 order by 1, 2;
