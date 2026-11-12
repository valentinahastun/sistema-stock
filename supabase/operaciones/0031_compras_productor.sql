-- 0031: COMPRAS → stock, más robusto.
-- * Si en la solapa cambia el productor de una compra que ya entró ("A confirmar"
--   → "Juan Esteban Boix"), el lote toma el productor nuevo y, si estaba en la
--   planta que salió del productor viejo (o en "A CONFIRMAR") y no hay columna
--   Planta, se muda a la planta del productor nuevo (mientras no tenga salidas).
-- * Si una fila cambia de clave (le corrigieron la fecha), antes de crear un
--   lote nuevo busca el lote de esa compra que ya había entrado y se vuelve a
--   vincular con él (mismo producto y tn, productor parecido, fecha cercana).
--   Así no se duplica.
-- * Arreglo: el Cranberry de Franzini (72 tn) había entrado dos veces.

alter table public.stock_compras add column if not exists productor text;

-- "CARLOS A. FRANZINI E HIJOS S.A " -> "carlos a franzini e hijos"
create or replace function public.compras_nombre(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '\(.*?\)', '', 'g'),
             '\s+(s\.?\s?a\.?|s\.?r\.?l\.?)\s*$', '', 'i'),
           '[^a-z0-9ñáéíóúü]+', ' ', 'g'))
$$;

-- Mismo productor escrito distinto: "Franzini e hijos" ~ "Carlos A. Franzini e Hijos"
create or replace function public.compras_mismo(a text, b text)
returns boolean
language sql
immutable
as $$
  select public.compras_nombre(a) = public.compras_nombre(b)
      or (length(public.compras_nombre(b)) >= 6 and position(public.compras_nombre(b) in public.compras_nombre(a)) > 0)
      or (length(public.compras_nombre(a)) >= 6 and position(public.compras_nombre(a) in public.compras_nombre(b)) > 0)
$$;

-- p_items: [{clave, fecha, productor, producto, estado, tn, cv, planta}]
create or replace function public.stock_compras(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  ya record;
  v_ya boolean;
  v_primera boolean;
  v_planta text; v_productor text; v_producto_id uuid; v_planta_id uuid; v_productor_id uuid;
  v_lote uuid;
  v_cargada boolean; v_existe_op boolean;
  v_planta_nueva uuid;
  v_prod_actual text; v_planta_actual text;
  v_nuevas int := 0; v_actualizadas int := 0; v_salteadas int := 0; v_vinculadas int := 0;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  v_primera := not exists (select 1 from stock_compras);

  for r in
    select * from jsonb_to_recordset(p_items) as x(clave text, fecha date, productor text, producto text,
                                                   estado text, tn numeric, cv text, planta text)
  loop
    if r.clave is null or coalesce(r.tn, 0) <= 0 or coalesce(trim(r.producto), '') = '' then continue; end if;

    -- Primera vez: lo que ya estaba en la solapa se registra sin cargarse (se cargó a mano el 05/11).
    if v_primera then
      select l.id into v_lote
      from lotes l join productos p on p.id = l.producto_id
      where l.cantidad_ingresada = r.tn and l.fecha_ingreso = r.fecha
        and (lower(p.nombre) = lower(trim(r.producto)) or (lower(r.producto) like '%mung%' and p.nombre = 'Poroto Mungo'))
        and coalesce(l.cv, '') = coalesce(r.cv, '')
        and exists (select 1 from movimientos_stock m where m.lote_id = l.id
                    and m.observaciones like '%Seguimiento COMEX > COMPRAS%')
        and not exists (select 1 from stock_compras s where s.lote_id = l.id)
      limit 1;
      insert into stock_compras (clave, lote_id, estado, cv, tn)
      values (r.clave, v_lote, case when v_lote is null then 'existente' else 'cargada' end, r.cv, r.tn)
      on conflict (clave) do nothing;
      continue;
    end if;

    -- Planta escrita en la columna "Planta" (si está): Agro Bull es BIURRUM
    r.planta := nullif(upper(trim(r.planta)), '');
    if r.planta ~ 'AGRO ?BULL' then r.planta := 'BIURRUM'; end if;

    -- Producto (Poroto Mung = Poroto Mungo)
    select id into v_producto_id from productos
    where lower(nombre) = lower(trim(r.producto))
       or (lower(trim(r.producto)) like '%mung%' and nombre = 'Poroto Mungo')
    order by (lower(nombre) = lower(trim(r.producto))) desc
    limit 1;
    if v_producto_id is null then v_salteadas := v_salteadas + 1; continue; end if;

    -- Productor (sin "S.A.", sin paréntesis) y planta por defecto (la del productor)
    v_productor := trim(regexp_replace(regexp_replace(coalesce(nullif(trim(r.productor), ''), 'A confirmar'),
                     '\(.*?\)', '', 'g'), '\s+(s\.?\s?a\.?|s\.?r\.?l\.?)\s*$', '', 'i'));
    v_planta := coalesce(r.planta,
                  case when lower(r.productor) like '%frigor%norte grande%' then 'BIURRUM' else upper(v_productor) end);
    if lower(r.productor) like '%frigor%norte grande%' then v_productor := 'Industrias Frigoríficas del Norte Grande'; end if;

    select * into ya from stock_compras where clave = r.clave;
    v_ya := found;

    -- Compra que ya había entrado con otra clave (le cambiaron la fecha) o que
    -- quedó registrada sin lote: se vuelve a vincular con su lote en vez de duplicarla.
    if not v_ya or (ya.lote_id is null and ya.estado = 'existente') then
      select l.id into v_lote
      from lotes l
      left join productores po on po.id = l.productor_id
      where l.producto_id = v_producto_id
        and l.cantidad_ingresada = r.tn
        and abs(l.fecha_ingreso - coalesce(r.fecha, op_hoy())) <= 45
        and (compras_mismo(po.nombre, v_productor) or compras_nombre(po.nombre) like 'a confirmar%' or po.nombre is null)
        and (l.cv is null or r.cv is null or l.cv = r.cv)
        and exists (select 1 from movimientos_stock m where m.lote_id = l.id and m.tipo = 'ingreso'
                    and m.observaciones like '%Seguimiento COMEX > COMPRAS%')
        and not exists (select 1 from stock_compras s where s.lote_id = l.id)
      order by abs(l.fecha_ingreso - coalesce(r.fecha, op_hoy())), l.fecha_ingreso
      limit 1;
      if v_lote is not null then
        insert into stock_compras (clave, lote_id, estado, cv, tn, planta, productor)
        select r.clave, v_lote, 'cargada', l.cv, l.cantidad_ingresada, null, null from lotes l where l.id = v_lote
        on conflict (clave) do update
          set lote_id = excluded.lote_id, estado = 'cargada', cv = excluded.cv, tn = excluded.tn,
              planta = null, productor = null, updated_at = now();
        select * into ya from stock_compras where clave = r.clave;
        v_ya := true;
        v_vinculadas := v_vinculadas + 1;
      end if;
    end if;

    if v_ya then
      if ya.lote_id is not null then
        select po.nombre, pl.nombre into v_prod_actual, v_planta_actual
        from lotes l join plantas pl on pl.id = l.planta_id left join productores po on po.id = l.productor_id
        where l.id = ya.lote_id;

        -- Cambió el productor en la solapa: el lote lo toma
        if not compras_mismo(coalesce(v_prod_actual, ''), v_productor) then
          select id into v_productor_id from productores where lower(trim(nombre)) = lower(v_productor) limit 1;
          if v_productor_id is null then
            insert into productores (nombre) values (v_productor) returning id into v_productor_id;
          end if;
          update lotes set productor_id = v_productor_id where id = ya.lote_id;
          update movimientos_stock set productor_id = v_productor_id where lote_id = ya.lote_id and tipo = 'ingreso';
          -- Si estaba en la planta del productor viejo (o "A CONFIRMAR") y la solapa no dice planta, se muda
          if r.planta is null
             and (upper(trim(v_planta_actual)) = upper(trim(coalesce(v_prod_actual, ''))) or upper(v_planta_actual) like 'A CONFIRMAR%')
             and upper(trim(v_planta_actual)) <> v_planta
             and not exists (select 1 from movimientos_stock where lote_id = ya.lote_id and tipo <> 'ingreso') then
            select id into v_planta_nueva from plantas where upper(trim(nombre)) = v_planta limit 1;
            if v_planta_nueva is null then
              insert into plantas (nombre) values (v_planta) returning id into v_planta_nueva;
            end if;
            update lotes set planta_id = v_planta_nueva where id = ya.lote_id;
            update movimientos_stock set planta_id = v_planta_nueva where lote_id = ya.lote_id and tipo = 'ingreso';
          end if;
          update stock_compras set productor = r.productor, updated_at = now() where clave = r.clave;
          v_actualizadas := v_actualizadas + 1;
        end if;

        -- Le pusieron (o cambiaron) la planta: se muda el lote si todavía no se movió
        if r.planta is not null and ya.planta is distinct from r.planta then
          select id into v_planta_nueva from plantas where upper(trim(nombre)) = r.planta limit 1;
          if v_planta_nueva is null then
            insert into plantas (nombre) values (r.planta) returning id into v_planta_nueva;
          end if;
          if not exists (select 1 from movimientos_stock where lote_id = ya.lote_id and tipo <> 'ingreso') then
            update lotes set planta_id = v_planta_nueva where id = ya.lote_id;
            update movimientos_stock set planta_id = v_planta_nueva where lote_id = ya.lote_id and tipo = 'ingreso';
            update stock_compras set planta = r.planta, updated_at = now() where clave = r.clave;
            v_actualizadas := v_actualizadas + 1;
          end if;
        end if;

        -- Cambios en una compra que ya entró: CV y tn del lote
        if ya.cv is distinct from r.cv or ya.tn is distinct from r.tn then
          update lotes set cv = r.cv where id = ya.lote_id and cv is distinct from r.cv;
          if ya.tn is distinct from r.tn and not exists (
               select 1 from movimientos_stock where lote_id = ya.lote_id and tipo <> 'ingreso') then
            update lotes set cantidad_ingresada = r.tn where id = ya.lote_id;
            update movimientos_stock set cantidad = r.tn where lote_id = ya.lote_id and tipo = 'ingreso';
          end if;
          update stock_compras set cv = r.cv, tn = r.tn, updated_at = now() where clave = r.clave;
          v_actualizadas := v_actualizadas + 1;
        end if;
      end if;
      continue;
    end if;

    -- Compra nueva con CV: si la operación ya cargó (o no está abierta), no entra
    if r.cv is not null then
      select exists (select 1 from op_operaciones o where o.cv = replace(substr(r.cv, 4), ' ', '') or o.cv = substr(r.cv, 4, 6))
        into v_existe_op;
      select exists (
        select 1 from op_operaciones o
        where o.cv = substr(r.cv, 4, 6)
          and (not o.activa or o.fecha_carga_planta < op_hoy()
               or exists (select 1 from op_hitos h where h.clave = o.clave and h.paso in ('camiones', 'consolidado'))))
        into v_cargada;
      if not v_existe_op then
        v_salteadas := v_salteadas + 1;   -- operación todavía no está en el tracking: se reintenta
        continue;
      end if;
      if v_cargada then
        insert into stock_compras (clave, lote_id, estado, cv, tn) values (r.clave, null, 'ya_cargada', r.cv, r.tn);
        continue;
      end if;
    end if;

    select id into v_productor_id from productores where lower(trim(nombre)) = lower(v_productor) limit 1;
    if v_productor_id is null then
      insert into productores (nombre) values (v_productor) returning id into v_productor_id;
    end if;
    select id into v_planta_id from plantas where upper(trim(nombre)) = v_planta limit 1;
    if v_planta_id is null then
      insert into plantas (nombre) values (v_planta) returning id into v_planta_id;
    end if;

    insert into lotes (planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada, cv)
    values (v_planta_id, v_producto_id, v_productor_id,
            case when lower(coalesce(r.estado, '')) = 'natural' then 'natural' else 'procesado' end,
            coalesce(r.fecha, op_hoy()), r.tn, r.cv)
    returning id into v_lote;
    insert into movimientos_stock (lote_id, tipo, cantidad, fecha, observaciones, planta_id, producto_id, productor_id)
    values (v_lote, 'ingreso', r.tn, coalesce(r.fecha, op_hoy()),
            'Compra ' || to_char(coalesce(r.fecha, op_hoy()), 'DD/MM/YYYY') || coalesce(' · ' || r.cv, ' · sin CV') ||
            ' · Seguimiento COMEX > COMPRAS', v_planta_id, v_producto_id, v_productor_id);
    insert into stock_compras (clave, lote_id, estado, cv, tn, planta, productor)
    values (r.clave, v_lote, 'cargada', r.cv, r.tn, r.planta, r.productor);
    v_nuevas := v_nuevas + 1;
  end loop;

  return jsonb_build_object('primera_vez', v_primera, 'nuevas', v_nuevas, 'actualizadas', v_actualizadas,
                            'vinculadas', v_vinculadas, 'salteadas', v_salteadas);
end;
$$;

-- Arreglo: el Cranberry de Franzini (72 tn, compra del 18/10) entró dos veces:
-- a mano en FRANZINI y por la sincronización en "FRANZINI E HIJOS" (cuando la
-- fila tenía otra fecha). Se borra el segundo; el primero se vuelve a vincular
-- solo con la fila de la solapa en la próxima sincronización (y toma el CV 26-144).
do $$
declare
  v_dup uuid := 'ed74781e-d002-4878-b835-c7a87c07237b';
  v_planta uuid;
  v_productor uuid;
begin
  if not exists (select 1 from lotes where id = v_dup) then
    raise notice 'El lote duplicado ya no está.';
    return;
  end if;
  if exists (select 1 from movimientos_stock where lote_id = v_dup and tipo <> 'ingreso')
     or exists (select 1 from proceso_entradas where lote_id = v_dup)
     or exists (select 1 from registros_calidad where lote_id = v_dup) then
    raise exception 'El lote duplicado ya tiene salidas, procesos o calidad: no se borra, revisarlo a mano.';
  end if;
  select planta_id, productor_id into v_planta, v_productor from lotes where id = v_dup;
  update stock_compras set lote_id = null, estado = 'duplicada', updated_at = now() where lote_id = v_dup;
  delete from movimientos_stock where lote_id = v_dup;
  delete from lotes where id = v_dup;
  -- La planta y el productor que se habían creado de más, si quedaron sin uso
  if not exists (select 1 from lotes where planta_id = v_planta)
     and not exists (select 1 from movimientos_stock where planta_id = v_planta)
     and not exists (select 1 from registros_calidad where planta_id = v_planta)
     and not exists (select 1 from procesos where planta_id = v_planta) then
    delete from plantas where id = v_planta;
  end if;
  if not exists (select 1 from lotes where productor_id = v_productor)
     and not exists (select 1 from movimientos_stock where productor_id = v_productor)
     and not exists (select 1 from registros_calidad where productor_id = v_productor) then
    delete from productores where id = v_productor;
  end if;
  raise notice 'Listo: se borró el Cranberry duplicado de FRANZINI E HIJOS.';
end;
$$;
