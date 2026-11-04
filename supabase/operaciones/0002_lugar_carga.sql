-- Operaciones Comex · cambio 2 (02/11/2026)
-- Agrega "Dónde se carga" y "Depósito" (de PROYECCION CARGAS / SEGUIMIENTO)
-- y actualiza la sincronización para guardarlos. No borra datos.
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

alter table public.op_operaciones
  add column if not exists lugar_carga text,
  add column if not exists deposito text;

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
  where h.fuente not in ('manual', 'mail')
    and (h.fecha is distinct from coalesce(excluded.fecha, h.fecha) or h.detalle is distinct from coalesce(excluded.detalle, h.detalle));
  get diagnostics v_hitos = row_count;

  return jsonb_build_object('nuevas', v_nuevas, 'hitos', v_hitos, 'cerradas', v_cerradas);
end;
$$;

revoke all on function public.op_sync(text, jsonb, jsonb) from public;
grant execute on function public.op_sync(text, jsonb, jsonb) to anon, authenticated;

select 'Listo: cambio 2 aplicado' as resultado;
