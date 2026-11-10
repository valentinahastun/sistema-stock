-- Tipos de descarte al cerrar un proceso:
--   segundilla (vuelve al stock y se puede reprocesar), descarte de la
--   electrónica, de la vibradora, de la clasificadora, inutilizable y volátil.
-- * Cada tipo (menos volátil) queda como stock del producto de descarte
--   (Descarte Negro, ...), con el tipo anotado en el lote.
-- * Volátil es lo que se pierde (polvo, humedad): es lo que falta para llegar
--   a lo que entró, no va al stock.
-- * La segundilla puede volver a entrar en un proceso de su producto.

alter table public.lotes add column if not exists tipo_descarte text;
alter table public.lotes drop constraint if exists lotes_tipo_descarte_check;
alter table public.lotes add constraint lotes_tipo_descarte_check check (
  tipo_descarte is null or tipo_descarte in ('segundilla', 'electronica', 'vibradora', 'clasificadora', 'inutilizable'));

alter table public.procesos add column if not exists segundilla_tn numeric(12, 3);
alter table public.procesos add column if not exists desc_electronica_tn numeric(12, 3);
alter table public.procesos add column if not exists desc_vibradora_tn numeric(12, 3);
alter table public.procesos add column if not exists desc_clasificadora_tn numeric(12, 3);
alter table public.procesos add column if not exists desc_inutilizable_tn numeric(12, 3);
alter table public.procesos add column if not exists volatil_tn numeric(12, 3);

-- Producto de descarte de un producto, sin crearlo (null si no hay)
create or replace function public.producto_descarte_buscar(p_producto uuid)
returns uuid
language sql stable
security definer set search_path = public
as $$
  select coalesce(
    (select producto_descarte_id from productos where id = p_producto),
    (select d.id from productos d, productos p
     where p.id = p_producto
       and d.nombre = 'Descarte ' || trim(regexp_replace(p.nombre, '^Poroto\s+', '', 'i'))));
$$;

-- p: {numero, planta_id, producto_id, cv, fecha_inicio, observaciones,
--     entradas: [{lote_id, cantidad}]}
create or replace function public.proceso_abrir(p jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_planta uuid := (p ->> 'planta_id')::uuid;
  v_producto uuid := (p ->> 'producto_id')::uuid;
  v_fecha date := coalesce(nullif(p ->> 'fecha_inicio', '')::date, current_date);
  v_numero text := nullif(trim(p ->> 'numero'), '');
  v_cv text := nullif(trim(p ->> 'cv'), '');
  v_total numeric := 0;
  v_desc uuid := public.producto_descarte_buscar((p ->> 'producto_id')::uuid);
  v_mov uuid;
  e record;
  l record;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede cargar procesos.'; end if;
  if v_planta is null or v_producto is null then raise exception 'Elegí la planta y el producto.'; end if;
  if jsonb_array_length(coalesce(p -> 'entradas', '[]'::jsonb)) = 0 then
    raise exception 'Elegí al menos un lote que entre al proceso.';
  end if;
  if (select count(distinct x ->> 'lote_id') from jsonb_array_elements(p -> 'entradas') x)
     <> jsonb_array_length(p -> 'entradas') then
    raise exception 'Hay un lote repetido.';
  end if;

  insert into procesos (numero, planta_id, producto_id, cv, fecha_inicio, observaciones)
  values (v_numero, v_planta, v_producto, v_cv, v_fecha, nullif(trim(p ->> 'observaciones'), ''))
  returning id into v_id;

  for e in select (x ->> 'lote_id')::uuid as lote_id, round((x ->> 'cantidad')::numeric, 3) as cantidad
           from jsonb_array_elements(p -> 'entradas') x
  loop
    select lo.id, lo.planta_id, lo.producto_id, lo.productor_id, lo.tipo_descarte, s.stock_actual_tn, pr.nombre as productor
      into l
    from lotes lo join stock_lotes s on s.lote_id = lo.id join productores pr on pr.id = lo.productor_id
    where lo.id = e.lote_id;
    if l.id is null then raise exception 'No se encontró un lote.'; end if;
    if l.planta_id <> v_planta or not (l.producto_id = v_producto
       or (l.producto_id = v_desc and l.tipo_descarte = 'segundilla')) then
      raise exception 'El lote de % no es de esa planta y producto.', l.productor;
    end if;
    if e.cantidad is null or e.cantidad <= 0 then
      raise exception 'Poné cuántas tn entran del lote de %.', l.productor;
    end if;
    if e.cantidad > l.stock_actual_tn + 0.0005 then
      raise exception 'Del lote de % hay % tn, no alcanza para %.', l.productor,
        round(l.stock_actual_tn, 3), e.cantidad;
    end if;

    insert into movimientos_stock (lote_id, tipo, cantidad, fecha, motivo, observaciones,
                                   planta_id, producto_id, productor_id, proceso_id)
    values (l.id, 'egreso', e.cantidad, v_fecha, 'proceso',
            'Entró al proceso' || coalesce(' N° ' || v_numero, ''), l.planta_id, l.producto_id, l.productor_id, v_id)
    returning id into v_mov;
    insert into proceso_entradas (proceso_id, lote_id, cantidad, movimiento_id)
    values (v_id, l.id, e.cantidad, v_mov);
    v_total := v_total + e.cantidad;
  end loop;

  update procesos set entrada_tn = v_total where id = v_id;
  return v_id;
end;
$$;

-- Cerrar un proceso: cuánto salió procesado, en qué bolsas y cómo se reparte
-- el descarte.
-- p: {procesado_tn, bolsas_25, bolsas_50, big_bags, fecha_fin,
--     segundilla_tn, desc_electronica_tn, desc_vibradora_tn,
--     desc_clasificadora_tn, desc_inutilizable_tn}
-- Volátil = lo que entró - procesado - los descartes cargados.
create or replace function public.proceso_cerrar(p_id uuid, p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pr record;
  g record;
  t record;
  v_proc numeric := round((p ->> 'procesado_tn')::numeric, 3);
  v_desc numeric;
  v_vol numeric;
  v_fecha date;
  v_b25 int := nullif(p ->> 'bolsas_25', '')::int;
  v_b50 int := nullif(p ->> 'bolsas_50', '')::int;
  v_bb int := nullif(p ->> 'big_bags', '')::int;
  v_tipos jsonb;
  v_cv text;
  v_prod_desc uuid;
  v_n int; v_i int := 0;
  v_acum_p numeric := 0; v_acum_25 int := 0; v_acum_50 int := 0; v_acum_bb int := 0;
  v_acum jsonb := '{}'::jsonb;
  v_tp numeric; v_td numeric; v_25 int; v_50 int; v_bbi int;
  v_lote uuid;
  v_txt text;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede cerrar procesos.'; end if;
  select * into pr from procesos where id = p_id for update;
  if pr.id is null then raise exception 'No se encontró el proceso.'; end if;
  if pr.historico then raise exception 'Es un proceso de la planilla, no se puede cerrar acá.'; end if;
  if pr.estado <> 'en_proceso' then raise exception 'El proceso ya está cerrado.'; end if;
  if v_proc is null or v_proc <= 0 then raise exception 'Poné cuántas tn salieron procesadas.'; end if;
  if v_proc > pr.entrada_tn then
    raise exception 'Salió más (% tn) de lo que entró (% tn).', v_proc, pr.entrada_tn;
  end if;
  v_fecha := coalesce(nullif(p ->> 'fecha_fin', '')::date, current_date);
  if v_fecha < pr.fecha_inicio then raise exception 'La fecha de fin es anterior al inicio.'; end if;
  v_desc := pr.entrada_tn - v_proc;
  v_txt := 'proceso' || coalesce(' N° ' || pr.numero, '');

  -- Tipos de descarte (tn), en el orden en que se muestran
  v_tipos := jsonb_build_object(
    'segundilla', coalesce(round(nullif(p ->> 'segundilla_tn', '')::numeric, 3), 0),
    'electronica', coalesce(round(nullif(p ->> 'desc_electronica_tn', '')::numeric, 3), 0),
    'vibradora', coalesce(round(nullif(p ->> 'desc_vibradora_tn', '')::numeric, 3), 0),
    'clasificadora', coalesce(round(nullif(p ->> 'desc_clasificadora_tn', '')::numeric, 3), 0),
    'inutilizable', coalesce(round(nullif(p ->> 'desc_inutilizable_tn', '')::numeric, 3), 0));
  if exists (select 1 from jsonb_each_text(v_tipos) where value::numeric < 0) then
    raise exception 'Los descartes no pueden ser negativos.';
  end if;
  v_vol := v_desc - (select sum(value::numeric) from jsonb_each_text(v_tipos));
  if v_vol < -0.0005 then
    raise exception 'Los descartes suman % tn, pero entre lo que entró y lo procesado hay % tn.',
      v_desc - v_vol, v_desc;
  end if;
  v_vol := greatest(v_vol, 0);

  -- CV: el del proceso, o el de los lotes que entraron si todos tienen el mismo
  v_cv := pr.cv;
  if v_cv is null then
    select min(lo.cv) into v_cv from proceso_entradas e join lotes lo on lo.id = e.lote_id
    where e.proceso_id = p_id having count(distinct coalesce(lo.cv, '')) = 1;
  end if;

  if v_desc - v_vol > 0 then v_prod_desc := producto_descarte_de(pr.producto_id); end if;

  select count(distinct lo.productor_id) into v_n
  from proceso_entradas e join lotes lo on lo.id = e.lote_id where e.proceso_id = p_id;

  for g in
    select lo.productor_id, sum(e.cantidad) as tn
    from proceso_entradas e join lotes lo on lo.id = e.lote_id
    where e.proceso_id = p_id
    group by lo.productor_id
    order by sum(e.cantidad) asc, lo.productor_id
  loop
    v_i := v_i + 1;
    if v_i = v_n then
      -- el último (el que más puso) se lleva el redondeo
      v_tp := v_proc - v_acum_p;
      v_25 := v_b25 - v_acum_25; v_50 := v_b50 - v_acum_50; v_bbi := v_bb - v_acum_bb;
    else
      v_tp := round(v_proc * g.tn / pr.entrada_tn, 3);
      v_25 := round(v_b25 * g.tn / pr.entrada_tn); v_50 := round(v_b50 * g.tn / pr.entrada_tn);
      v_bbi := round(v_bb * g.tn / pr.entrada_tn);
      v_acum_p := v_acum_p + v_tp;
      v_acum_25 := v_acum_25 + coalesce(v_25, 0); v_acum_50 := v_acum_50 + coalesce(v_50, 0);
      v_acum_bb := v_acum_bb + coalesce(v_bbi, 0);
    end if;

    if v_tp > 0 then
      insert into lotes (planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada,
                         cv, bolsas_25, bolsas_50, big_bags, proceso_id)
      values (pr.planta_id, pr.producto_id, g.productor_id, 'procesado', v_fecha, v_tp,
              v_cv, v_25, v_50, v_bbi, p_id)
      returning id into v_lote;
      insert into movimientos_stock (lote_id, tipo, cantidad, fecha, motivo, observaciones,
                                     planta_id, producto_id, productor_id, proceso_id)
      values (v_lote, 'ingreso', v_tp, v_fecha, 'proceso', 'Salió del ' || v_txt,
              pr.planta_id, pr.producto_id, g.productor_id, p_id);
    end if;

    -- Cada tipo de descarte, repartido igual que lo procesado
    for t in select key, value::numeric as total from jsonb_each_text(v_tipos) where value::numeric > 0 loop
      if v_i = v_n then
        v_td := t.total - coalesce((v_acum ->> t.key)::numeric, 0);
      else
        v_td := round(t.total * g.tn / pr.entrada_tn, 3);
        v_acum := jsonb_set(v_acum, array[t.key], to_jsonb(coalesce((v_acum ->> t.key)::numeric, 0) + v_td));
      end if;
      if v_td > 0 then
        insert into lotes (planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada,
                           cv, proceso_id, tipo_descarte)
        values (pr.planta_id, v_prod_desc, g.productor_id, 'natural', v_fecha, v_td, v_cv, p_id, t.key)
        returning id into v_lote;
        insert into movimientos_stock (lote_id, tipo, cantidad, fecha, motivo, observaciones,
                                       planta_id, producto_id, productor_id, proceso_id)
        values (v_lote, 'ingreso', v_td, v_fecha, 'proceso',
                case t.key when 'segundilla' then 'Segundilla' when 'electronica' then 'Descarte de la electrónica'
                  when 'vibradora' then 'Descarte de la vibradora' when 'clasificadora' then 'Descarte de la clasificadora'
                  else 'Descarte inutilizable' end || ' del ' || v_txt,
                pr.planta_id, v_prod_desc, g.productor_id, p_id);
      end if;
    end loop;
  end loop;

  update procesos
  set estado = 'terminado', fecha_fin = v_fecha, procesado_tn = v_proc, descarte_tn = v_desc,
      bolsas_25 = v_b25, bolsas_50 = v_b50, big_bags = v_bb,
      segundilla_tn = nullif((v_tipos ->> 'segundilla')::numeric, 0),
      desc_electronica_tn = nullif((v_tipos ->> 'electronica')::numeric, 0),
      desc_vibradora_tn = nullif((v_tipos ->> 'vibradora')::numeric, 0),
      desc_clasificadora_tn = nullif((v_tipos ->> 'clasificadora')::numeric, 0),
      desc_inutilizable_tn = nullif((v_tipos ->> 'inutilizable')::numeric, 0),
      volatil_tn = nullif(round(v_vol, 3), 0)
  where id = p_id;
end;
$$;

-- Deshacer el cierre también limpia el reparto del descarte
create or replace function public.proceso_limpiar_descartes()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'en_proceso' and old.estado = 'terminado' then
    new.segundilla_tn := null; new.desc_electronica_tn := null; new.desc_vibradora_tn := null;
    new.desc_clasificadora_tn := null; new.desc_inutilizable_tn := null; new.volatil_tn := null;
  end if;
  return new;
end;
$$;
drop trigger if exists procesos_limpiar_descartes on public.procesos;
create trigger procesos_limpiar_descartes before update on public.procesos
for each row execute function public.proceso_limpiar_descartes();

revoke all on function public.producto_descarte_buscar(uuid) from public;
grant execute on function public.producto_descarte_buscar(uuid) to authenticated;
