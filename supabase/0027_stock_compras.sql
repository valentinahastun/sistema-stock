-- 0027: Las compras de Seguimiento COMEX > COMPRAS entran solas al stock.
-- El script de Google lee la solapa (cada 15 min, con la sincronización) y llama a stock_compras().
-- * Compra nueva con CV que todavía no cargó: lote comprometido a ese CV.
-- * Compra nueva sin CV: stock libre.
-- * Si a una compra ya cargada le ponen (o cambian) el CV, o cambian las tn, se actualiza su lote.
-- * Las compras de CV que ya cargaron (o ya cerraron) no entran.
-- * Planta = productor, salvo Ind. Frig. del Norte Grande, que está en BIURRUM.
-- Las 20 compras que ya estaban en la solapa quedan registradas la primera vez, sin cargarse de nuevo.

create table if not exists public.stock_compras (
  clave text primary key,          -- fecha|productor|producto|parte
  lote_id uuid references public.lotes (id) on delete set null,
  estado text not null,            -- cargada | ya_cargada | existente
  cv text,
  tn numeric(12, 3),
  updated_at timestamptz not null default now()
);
alter table public.stock_compras enable row level security;
drop policy if exists "lectura autenticados" on public.stock_compras;
create policy "lectura autenticados" on public.stock_compras for select using (auth.role() = 'authenticated');

-- p_items: [{clave, fecha, productor, producto, estado, tn, cv}]
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
  v_nuevas int := 0; v_actualizadas int := 0; v_salteadas int := 0;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  v_primera := not exists (select 1 from stock_compras);

  for r in
    select * from jsonb_to_recordset(p_items) as x(clave text, fecha date, productor text, producto text,
                                                   estado text, tn numeric, cv text)
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

    select * into ya from stock_compras where clave = r.clave;
    if found then
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
    v_planta := case when lower(r.productor) like '%frigor%norte grande%' then 'BIURRUM' else upper(v_productor) end;
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
    insert into stock_compras (clave, lote_id, estado, cv, tn) values (r.clave, v_lote, 'cargada', r.cv, r.tn);
    v_nuevas := v_nuevas + 1;
  end loop;

  return jsonb_build_object('primera_vez', v_primera, 'nuevas', v_nuevas, 'actualizadas', v_actualizadas, 'salteadas', v_salteadas);
end;
$$;
revoke all on function public.stock_compras(text, jsonb) from public;
grant execute on function public.stock_compras(text, jsonb) to anon, authenticated;
