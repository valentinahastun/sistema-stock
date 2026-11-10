-- Procesos de la planilla Proceso_Stock (corte 05/11/2026), como históricos.
-- Solo quedan registrados para verlos en Procesos: no mueven stock, porque el
-- stock que cargamos el 05/11 ya es el resultado de estos procesos.
-- Valores en toneladas (la planilla está en kg).

-- Todo va en un solo bloque: si algo no coincide con los catálogos, no carga nada.
do $$
declare
  x record;
  v_planta uuid;
  v_producto uuid;
begin
  if exists (select 1 from public.procesos where historico) then
    raise exception 'Los procesos de la planilla ya estaban cargados.';
  end if;

  for x in
    select * from (values
  -- Legucer
  ('47', 'LEGUCER', 'Poroto Negro', '2026-04-13', 'Río Blanco del Tontón, La Bajada, Palacio José Luis',
   'CV 26-044, CV 26-057, CV 26-062 A, CV 26-062 B', 366.015, 364.185, 1.830,
   'Incluye lo procesado del proceso 46 que volvió a entrar.'),
  ('46', 'LEGUCER', 'Poroto Negro', '2026-04-13', null,
   'CV 26-071, CV 26-081 B, CV 26-088 A', 167.400, 142.419, 24.981,
   'Se embolsaron 72,64 tn; el resto (69,78 tn) volvió a entrar en el proceso 47.'),
  ('57', 'LEGUCER', 'Poroto Mung', '2026-06-17', null, null, 153.680, 120.500, 33.180, null),
  ('62', 'LEGUCER', 'Poroto Colorado Dark', '2026-07-01', 'Decrops', null, 36.360, 27.750, 8.610, null),
  ('64', 'LEGUCER', 'Poroto Negro', '2026-07-13', null, null, 226.900, 210.200, 15.600,
   'En la planilla, ingreso menos embolsado da 16,7 tn de descarte, pero figura 15,6 tn.'),
  ('67', 'LEGUCER', 'Poroto Cranberry', '2026-07-27', null, 'CV 26-096, CV 26-104, CV 26-132', 72.180, 61.925, 10.255, null),
  ('71', 'LEGUCER', 'Poroto Colorado Dark', '2026-08-26', 'La Bajada', 'CV 26-099', 63.360, 48.750, 14.610, null),
  -- Caballero
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Colorado Dark', '2026-09-11', 'CEF', 'CV 26-093', 28.360, 22.150, 6.210, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Cranberry', '2026-07-22', 'El Valle', 'CV 26-073', 155.400, 133.125, 22.275, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-07-08', 'Expogran', 'CV 26-079', 157.420, 143.375, 14.045, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-07-21', 'Giacopo Bruno', 'CV 26-080 A', 151.720, 138.050, 13.670, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-07-29', 'Flores Enrique', 'CV 26-086', 216.580, 171.725, 44.855, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-09-25', 'Expogran', 'CV 26-118', 187.480, 176.100, 11.380, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-09-26', 'Baya Casal', 'CV 26-095, CV 26-103', 167.140, 123.425, 43.715, null),
  (null, 'CABALLERO LUIS ALBERTO', 'Poroto Alubia', '2026-10-23', 'Los Dos Ríos', 'CV 26-137', 119.480, 112.975, 6.505, null),
  -- Alimentos Tropicales
  (null, 'ALIMENTOS TROPICALES', 'Poroto Alubia', '2026-07-28', 'Flores, Santa Cecilia', 'CV 26-079, CV 26-080 A', 231.250, 208.600, 22.650, null),
  (null, 'ALIMENTOS TROPICALES', 'Poroto Alubia', '2026-08-21', 'Palacios Pantaleón, Flores Enrique', 'CV 26-092, CV 26-090', 316.310, 268.000, 48.310, null),
  -- Fracoga
  (null, 'FRACOGA', 'Poroto Negro', '2026-08-14', 'Decrops', 'CV 26-088 B', 16.440, 15.160, 1.280, null)
    ) as t(numero, planta, producto, fecha, productores, cv, entrada, procesado, descarte, obs)
  loop
    select id into v_planta from public.plantas where nombre = x.planta;
    select id into v_producto from public.productos
    where nombre = x.producto or (x.producto = 'Poroto Mung' and nombre = 'Poroto Mungo')
    order by (nombre = x.producto) desc limit 1;
    if v_planta is null or v_producto is null then
      raise exception 'No encontré en los catálogos: % / %', x.planta, x.producto;
    end if;

    insert into public.procesos (numero, planta_id, producto_id, cv, estado, fecha_inicio, fecha_fin,
                                 entrada_tn, procesado_tn, descarte_tn, historico, productores_texto, observaciones)
    values (x.numero, v_planta, v_producto, x.cv, 'terminado', x.fecha::date, x.fecha::date,
            x.entrada, x.procesado, x.descarte, true, x.productores,
            coalesce(x.obs || ' ', '') || 'Cargado de la planilla Proceso_Stock.');
  end loop;

  -- Los lotes del stock inicial que salieron de un solo proceso numerado quedan ligados a él
  update public.lotes l
  set proceso_id = pr.id
  from public.movimientos_stock m, public.procesos pr
  where m.lote_id = l.id and m.tipo = 'ingreso'
    and m.observaciones like '%inicial 05/11/2026%'
    and pr.historico and pr.numero is not null and pr.planta_id = l.planta_id
    and m.observaciones ~ ('Proceso ' || pr.numero || '( |$)')
    and m.observaciones !~* 'proceso.*proceso'
    and l.proceso_id is null;
end $$;

select coalesce('Proceso ' || numero, 'Proceso del ' || to_char(fecha_inicio, 'DD/MM')) as proceso,
       entrada_tn, procesado_tn, descarte_tn,
       (select count(*) from public.lotes l where l.proceso_id = p.id) as lotes_ligados
from public.procesos p where historico order by fecha_inicio;
