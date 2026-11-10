-- Procesos: la mercadería natural (o procesada que se reprocesa) entra a un
-- proceso en una planta y sale procesada + descarte.
--
-- * Abrir un proceso: cada lote que entra baja su stock (salida con
--   motivo 'proceso', ligada al proceso). Queda "En proceso".
-- * Cerrar un proceso: se carga cuánto salió procesado (y en qué bolsas).
--   El descarte es la diferencia. Se crea un lote procesado por productor,
--   en proporción a lo que puso cada uno, y el descarte suma al producto
--   de descarte (Descarte Negro, Descarte Alubia, ...).
-- * Lo procesado puede volver a entrar en otro proceso (reproceso).
-- * Los procesos de la planilla vieja quedan como históricos: muestran
--   los números, pero no mueven stock (el stock de hoy ya los incluye).

create table if not exists public.procesos (
  id uuid primary key default gen_random_uuid(),
  numero text,
  planta_id uuid not null references public.plantas (id),
  producto_id uuid not null references public.productos (id),
  cv text,
  estado text not null default 'en_proceso' check (estado in ('en_proceso', 'terminado')),
  fecha_inicio date not null default current_date,
  fecha_fin date,
  entrada_tn numeric(12, 3) not null default 0,
  procesado_tn numeric(12, 3),
  descarte_tn numeric(12, 3),
  bolsas_25 integer check (bolsas_25 is null or bolsas_25 >= 0),
  bolsas_50 integer check (bolsas_50 is null or bolsas_50 >= 0),
  big_bags integer check (big_bags is null or big_bags >= 0),
  historico boolean not null default false,
  productores_texto text,          -- solo en los históricos de la planilla
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists procesos_planta_producto_idx on public.procesos (planta_id, producto_id);

create table if not exists public.proceso_entradas (
  id uuid primary key default gen_random_uuid(),
  proceso_id uuid not null references public.procesos (id) on delete cascade,
  lote_id uuid not null references public.lotes (id),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  movimiento_id uuid references public.movimientos_stock (id) on delete set null
);
create index if not exists proceso_entradas_proceso_idx on public.proceso_entradas (proceso_id);
create index if not exists proceso_entradas_lote_idx on public.proceso_entradas (lote_id);

-- Lote que salió de un proceso, y movimientos generados por un proceso
alter table public.lotes add column if not exists proceso_id uuid references public.procesos (id) on delete set null;
alter table public.movimientos_stock add column if not exists proceso_id uuid references public.procesos (id) on delete set null;
create index if not exists movimientos_proceso_idx on public.movimientos_stock (proceso_id);

alter table public.procesos enable row level security;
alter table public.proceso_entradas enable row level security;
drop policy if exists "lectura autenticados" on public.procesos;
drop policy if exists "escritura solo admin" on public.procesos;
drop policy if exists "lectura autenticados" on public.proceso_entradas;
drop policy if exists "escritura solo admin" on public.proceso_entradas;
create policy "lectura autenticados" on public.procesos for select using (auth.role() = 'authenticated');
create policy "escritura solo admin" on public.procesos for all using (public.is_admin()) with check (public.is_admin());
create policy "lectura autenticados" on public.proceso_entradas for select using (auth.role() = 'authenticated');
create policy "escritura solo admin" on public.proceso_entradas for all using (public.is_admin()) with check (public.is_admin());

-- Producto de descarte de un producto (lo crea si no existe: "Descarte Negro")
create or replace function public.producto_descarte_de(p_producto uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_nombre text;
begin
  select producto_descarte_id, nombre into v_id, v_nombre from productos where id = p_producto;
  if v_id is not null then return v_id; end if;
  v_nombre := 'Descarte ' || trim(regexp_replace(v_nombre, '^Poroto\s+', '', 'i'));
  select id into v_id from productos where nombre = v_nombre;
  if v_id is null then
    insert into productos (nombre) values (v_nombre) returning id into v_id;
  end if;
  update productos set producto_descarte_id = v_id where id = p_producto;
  return v_id;
end;
$$;

-- Abrir un proceso.
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
    select lo.id, lo.planta_id, lo.producto_id, lo.productor_id, s.stock_actual_tn, pr.nombre as productor
      into l
    from lotes lo join stock_lotes s on s.lote_id = lo.id join productores pr on pr.id = lo.productor_id
    where lo.id = e.lote_id;
    if l.id is null then raise exception 'No se encontró un lote.'; end if;
    if l.planta_id <> v_planta or l.producto_id <> v_producto then
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

-- Cerrar un proceso: cuánto salió procesado y en qué bolsas.
-- p: {procesado_tn, bolsas_25, bolsas_50, big_bags, fecha_fin}
create or replace function public.proceso_cerrar(p_id uuid, p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pr record;
  g record;
  v_proc numeric := round((p ->> 'procesado_tn')::numeric, 3);
  v_desc numeric;
  v_fecha date;
  v_b25 int := nullif(p ->> 'bolsas_25', '')::int;
  v_b50 int := nullif(p ->> 'bolsas_50', '')::int;
  v_bb int := nullif(p ->> 'big_bags', '')::int;
  v_cv text;
  v_prod_desc uuid;
  v_n int; v_i int := 0;
  v_acum_p numeric := 0; v_acum_d numeric := 0;
  v_acum_25 int := 0; v_acum_50 int := 0; v_acum_bb int := 0;
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

  -- CV: el del proceso, o el de los lotes que entraron si todos tienen el mismo
  v_cv := pr.cv;
  if v_cv is null then
    select min(lo.cv) into v_cv from proceso_entradas e join lotes lo on lo.id = e.lote_id
    where e.proceso_id = p_id having count(distinct coalesce(lo.cv, '')) = 1;
  end if;

  if v_desc > 0 then v_prod_desc := producto_descarte_de(pr.producto_id); end if;

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
      v_tp := v_proc - v_acum_p; v_td := v_desc - v_acum_d;
      v_25 := v_b25 - v_acum_25; v_50 := v_b50 - v_acum_50; v_bbi := v_bb - v_acum_bb;
    else
      v_tp := round(v_proc * g.tn / pr.entrada_tn, 3);
      v_td := round(v_desc * g.tn / pr.entrada_tn, 3);
      v_25 := round(v_b25 * g.tn / pr.entrada_tn); v_50 := round(v_b50 * g.tn / pr.entrada_tn);
      v_bbi := round(v_bb * g.tn / pr.entrada_tn);
      v_acum_p := v_acum_p + v_tp; v_acum_d := v_acum_d + v_td;
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

    if v_td > 0 then
      insert into lotes (planta_id, producto_id, productor_id, estado, fecha_ingreso, cantidad_ingresada, cv, proceso_id)
      values (pr.planta_id, v_prod_desc, g.productor_id, 'natural', v_fecha, v_td, v_cv, p_id)
      returning id into v_lote;
      insert into movimientos_stock (lote_id, tipo, cantidad, fecha, motivo, observaciones,
                                     planta_id, producto_id, productor_id, proceso_id)
      values (v_lote, 'ingreso', v_td, v_fecha, 'proceso', 'Descarte del ' || v_txt,
              pr.planta_id, v_prod_desc, g.productor_id, p_id);
    end if;
  end loop;

  update procesos
  set estado = 'terminado', fecha_fin = v_fecha, procesado_tn = v_proc, descarte_tn = v_desc,
      bolsas_25 = v_b25, bolsas_50 = v_b50, big_bags = v_bb
  where id = p_id;
end;
$$;

-- Deshacer el cierre (para corregir lo que salió): vuelve a "En proceso".
-- No se puede si lo que salió ya se movió (salida, descarte o reproceso).
create or replace function public.proceso_deshacer_cierre(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pr record;
  v_usado text;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede modificar procesos.'; end if;
  select * into pr from procesos where id = p_id for update;
  if pr.id is null then raise exception 'No se encontró el proceso.'; end if;
  if pr.historico then raise exception 'Es un proceso de la planilla, no se puede modificar acá.'; end if;
  if pr.estado <> 'terminado' then raise exception 'El proceso no está cerrado.'; end if;

  select coalesce(q.numero, 'sin número') into v_usado
  from movimientos_stock m join lotes lo on lo.id = m.lote_id
  left join procesos q on q.id = m.proceso_id
  where lo.proceso_id = p_id and (m.proceso_id is distinct from p_id)
  limit 1;
  if found then
    raise exception 'Lo que salió de este proceso ya se usó (por ejemplo en el proceso %). Primero borrá eso.', v_usado;
  end if;

  delete from movimientos_stock m using lotes lo
  where m.lote_id = lo.id and lo.proceso_id = p_id and m.proceso_id = p_id;
  delete from lotes where proceso_id = p_id
    and not exists (select 1 from movimientos_stock m where m.lote_id = lotes.id)
    and not exists (select 1 from proceso_entradas e where e.lote_id = lotes.id);

  update procesos
  set estado = 'en_proceso', fecha_fin = null, procesado_tn = null, descarte_tn = null,
      bolsas_25 = null, bolsas_50 = null, big_bags = null
  where id = p_id;
end;
$$;

-- Borrar un proceso: los lotes que entraron recuperan su stock.
create or replace function public.proceso_eliminar(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pr record;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede borrar procesos.'; end if;
  select * into pr from procesos where id = p_id;
  if pr.id is null then raise exception 'No se encontró el proceso.'; end if;
  if pr.estado = 'terminado' and not pr.historico then
    perform proceso_deshacer_cierre(p_id);
  end if;
  update lotes set proceso_id = null where proceso_id = p_id;   -- históricos: solo se desliga
  delete from movimientos_stock where proceso_id = p_id and tipo = 'egreso';
  delete from procesos where id = p_id;
end;
$$;

revoke all on function public.proceso_abrir(jsonb) from public;
revoke all on function public.proceso_cerrar(uuid, jsonb) from public;
revoke all on function public.proceso_deshacer_cierre(uuid) from public;
revoke all on function public.proceso_eliminar(uuid) from public;
revoke all on function public.producto_descarte_de(uuid) from public;
grant execute on function public.proceso_abrir(jsonb) to authenticated;
grant execute on function public.proceso_cerrar(uuid, jsonb) to authenticated;
grant execute on function public.proceso_deshacer_cierre(uuid) to authenticated;
grant execute on function public.proceso_eliminar(uuid) to authenticated;
