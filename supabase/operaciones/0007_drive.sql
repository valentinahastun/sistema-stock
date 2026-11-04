-- Operaciones Comex · cambio 7 (03/11/2026)
-- Documentos desde las carpetas de Drive de cada operación:
--   carpeta "CV 26-xxx ..." > DOCUS EXPO > Docus Definitivos / Docus Originales
-- El script mira qué originales hay ahí y marca los documentos solos.
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

-- Nueva fuente "drive" para los pasos
alter table public.op_hitos drop constraint if exists op_hitos_fuente_check;
alter table public.op_hitos add constraint op_hitos_fuente_check
  check (fuente in ('manual', 'mail', 'drive', 'ventas', 'seguimiento', 'proyeccion', 'pagos_fletes', 'cobranzas'));

-- Link a la carpeta de la operación
alter table public.op_operaciones add column if not exists carpeta_url text;

-- La sincronización con las planillas tampoco pisa lo que vino de Drive
create or replace function public.op_sync(p_token text, p_ops jsonb, p_hitos jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_nuevas int := 0;
  v_hitos int := 0;
  v_cerradas int := 0;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'no autorizado';
  end if;

  create temp table _prev on commit drop as
    select clave, sincronizada_at from op_operaciones;

  insert into op_operaciones as o (
    clave, cv, lote, cliente, broker, silver, destino, producto, tn, responsable,
    payment_terms, fecha_contrato, tipo_bl, booking, contenedores, fecha_carga_planta,
    fecha_consolidado, corte_documental, lugar_carga, deposito, etd, eta, activa, sincronizada_at)
  select x.clave, x.cv, nullif(x.lote, ''), x.cliente, x.broker, coalesce(x.silver, false),
         x.destino, x.producto, x.tn, x.responsable, x.payment_terms, x.fecha_contrato, x.tipo_bl,
         x.booking, x.contenedores, x.fecha_carga_planta, x.fecha_consolidado,
         x.corte_documental, x.lugar_carga, x.deposito, x.etd, x.eta, true, now()
  from jsonb_to_recordset(p_ops) as x(
    clave text, cv text, lote text, cliente text, broker text, silver boolean,
    destino text, producto text, tn numeric, responsable text, payment_terms text,
    fecha_contrato date, tipo_bl text, booking text, contenedores text, fecha_carga_planta date,
    fecha_consolidado date, corte_documental date, lugar_carga text, deposito text, etd date, eta date)
  on conflict (clave) do update set
    cv = excluded.cv, lote = excluded.lote,
    cliente = coalesce(excluded.cliente, o.cliente),
    broker = coalesce(excluded.broker, o.broker),
    silver = excluded.silver,
    destino = coalesce(excluded.destino, o.destino),
    producto = coalesce(excluded.producto, o.producto),
    tn = coalesce(excluded.tn, o.tn),
    responsable = coalesce(o.responsable, excluded.responsable),   -- lo elegido en la app manda
    payment_terms = coalesce(excluded.payment_terms, o.payment_terms),
    fecha_contrato = coalesce(excluded.fecha_contrato, o.fecha_contrato),
    tipo_bl = coalesce(excluded.tipo_bl, o.tipo_bl),
    booking = coalesce(excluded.booking, o.booking),
    contenedores = coalesce(nullif(excluded.contenedores, ''), o.contenedores),
    fecha_carga_planta = coalesce(excluded.fecha_carga_planta, o.fecha_carga_planta),
    fecha_consolidado = coalesce(excluded.fecha_consolidado, o.fecha_consolidado),
    corte_documental = coalesce(excluded.corte_documental, o.corte_documental),
    lugar_carga = coalesce(excluded.lugar_carga, o.lugar_carga),
    deposito = coalesce(excluded.deposito, o.deposito),
    etd = coalesce(excluded.etd, o.etd),
    eta = coalesce(excluded.eta, o.eta),
    activa = true,
    sincronizada_at = now();

  select count(*) into v_nuevas
  from jsonb_to_recordset(p_ops) as x(clave text)
  where not exists (select 1 from _prev p where p.clave = x.clave);

  update op_operaciones set activa = false
  where activa and clave not in (select x.clave from jsonb_to_recordset(p_ops) as x(clave text));
  get diagnostics v_cerradas = row_count;

  insert into op_hitos as h (clave, paso, fecha, fuente, detalle, updated_by)
  select x.clave, x.paso,
         coalesce(x.fecha, case when p.sincronizada_at is not null then op_hoy() end),
         x.fuente, x.detalle, 'sincronizacion'
  from jsonb_to_recordset(p_hitos) as x(clave text, paso text, fecha date, fuente text, detalle text)
  join op_operaciones o on o.clave = x.clave
  left join _prev p on p.clave = x.clave
  on conflict (clave, paso) do update set
    fecha = coalesce(excluded.fecha, h.fecha),
    detalle = coalesce(excluded.detalle, h.detalle),
    fuente = excluded.fuente,
    updated_at = now()
  where h.fuente not in ('manual', 'mail', 'drive')
    and (h.fecha is distinct from coalesce(excluded.fecha, h.fecha) or h.detalle is distinct from coalesce(excluded.detalle, h.detalle));
  get diagnostics v_hitos = row_count;

  return jsonb_build_object('nuevas', v_nuevas, 'hitos', v_hitos, 'cerradas', v_cerradas);
end;
$$;

revoke all on function public.op_sync(text, jsonb, jsonb) from public;
grant execute on function public.op_sync(text, jsonb, jsonb) to anon, authenticated;

-- Operaciones abiertas para que el script busque sus carpetas
create or replace function public.op_activas_token(p_token text)
returns table (clave text, cv text, lote text, booking text)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if p_token is null or p_token <> (select valor from op_config where op_config.clave = 'token_sync') then
    raise exception 'token inválido';
  end if;
  return query select o.clave, o.cv, o.lote, o.booking from op_operaciones o where o.activa order by o.clave;
end;
$$;
revoke all on function public.op_activas_token(text) from public;
grant execute on function public.op_activas_token(text) to anon, authenticated;

-- p_items:    [{clave, paso, fecha (yyyy-mm-dd), detalle, url}]
-- p_carpetas: [{clave, url}]
-- Nunca pisa lo cargado a mano ni lo que vino del mail; si ya venía de Drive,
-- deja la fecha más vieja.
create or replace function public.op_drive(p_token text, p_items jsonb, p_carpetas jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_hitos int;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  update op_operaciones o set carpeta_url = c.url
  from jsonb_to_recordset(coalesce(p_carpetas, '[]')) as c(clave text, url text)
  where o.clave = c.clave and o.carpeta_url is distinct from c.url;

  insert into op_hitos as h (clave, paso, fecha, fuente, detalle, mail_url, updated_by, updated_at)
  select distinct on (x.clave, x.paso) x.clave, x.paso, x.fecha, 'drive', left(x.detalle, 200), x.url, 'drive', now()
  from jsonb_to_recordset(coalesce(p_items, '[]')) as x(clave text, paso text, fecha date, detalle text, url text)
  join op_operaciones o on o.clave = x.clave
  order by x.clave, x.paso, x.fecha
  on conflict (clave, paso) do update set
    fecha = excluded.fecha, fuente = 'drive', detalle = excluded.detalle,
    mail_url = excluded.mail_url, updated_by = 'drive', updated_at = now()
  where h.fuente not in ('manual', 'mail', 'drive')
     or (h.fuente = 'drive' and h.fecha > excluded.fecha);
  get diagnostics v_hitos = row_count;
  return jsonb_build_object('hitos', v_hitos);
end;
$$;
revoke all on function public.op_drive(text, jsonb, jsonb) from public;
grant execute on function public.op_drive(text, jsonb, jsonb) to anon, authenticated;
