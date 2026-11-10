-- 0029: COMPRAS puede traer una columna "Planta" (de qué planta se saca la compra).
-- * Compra nueva con planta: el lote va a esa planta (si no, como antes: planta = productor).
-- * Si a una compra que ya entró le ponen o cambian la planta, el lote se muda
--   (mientras no haya tenido salidas ni descartes).

alter table public.stock_compras add column if not exists planta text;

-- p_items: [{clave, fecha, productor, producto, estado, tn, cv, planta}]
create or replace function public.stock_compras(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  ya record;
  v_primera boolean;
  v_planta text; v_productor text; v_producto_id uuid; v_planta_id uuid; v_productor_id uuid;
  v_lote uuid;
  v_cargada boolean; v_existe_op boolean;
  v_planta_nueva uuid;
  v_nuevas int := 0; v_actualizadas int := 0; v_salteadas int := 0;
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

    select * into ya from stock_compras where clave = r.clave;
    if found then
      -- Le pusieron (o cambiaron) la planta: se muda el lote si todavía no se movió
      if ya.lote_id is not null and r.planta is not null and ya.planta is distinct from r.planta then
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
      if ya.lote_id is not null and (ya.cv is distinct from r.cv or ya.tn is distinct from r.tn) then
        update lotes set cv = r.cv where id = ya.lote_id and cv is distinct from r.cv;
        if ya.tn is distinct from r.tn and not exists (
             select 1 from movimientos_stock where lote_id = ya.lote_id and tipo <> 'ingreso') then
          update lotes set cantidad_ingresada = r.tn where id = ya.lote_id;
          update movimientos_stock set cantidad = r.tn where lote_id = ya.lote_id and tipo = 'ingreso';
        end if;
        update stock_compras set cv = r.cv, tn = r.tn, updated_at = now() where clave = r.clave;
        v_actualizadas := v_actualizadas + 1;
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

    -- Producto (Poroto Mung = Poroto Mungo)
    select id into v_producto_id from productos
    where lower(nombre) = lower(trim(r.producto))
       or (lower(trim(r.producto)) like '%mung%' and nombre = 'Poroto Mungo')
    order by (lower(nombre) = lower(trim(r.producto))) desc
    limit 1;
    if v_producto_id is null then v_salteadas := v_salteadas + 1; continue; end if;

    -- Productor y planta
    v_productor := trim(regexp_replace(regexp_replace(coalesce(nullif(trim(r.productor), ''), 'A confirmar'),
                     '\(.*?\)', '', 'g'), '\s+(s\.?\s?a\.?|s\.?r\.?l\.?)\s*$', '', 'i'));
    v_planta := coalesce(r.planta,
                  case when lower(r.productor) like '%frigor%norte grande%' then 'BIURRUM' else upper(v_productor) end);
    if lower(r.productor) like '%frigor%norte grande%' then v_productor := 'Industrias Frigoríficas del Norte Grande'; end if;

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
    insert into stock_compras (clave, lote_id, estado, cv, tn, planta) values (r.clave, v_lote, 'cargada', r.cv, r.tn, r.planta);
    v_nuevas := v_nuevas + 1;
  end loop;

  return jsonb_build_object('primera_vez', v_primera, 'nuevas', v_nuevas, 'actualizadas', v_actualizadas, 'salteadas', v_salteadas);
end;
$$;
revoke all on function public.stock_compras(text, jsonb) from public;
grant execute on function public.stock_compras(text, jsonb) to anon, authenticated;
