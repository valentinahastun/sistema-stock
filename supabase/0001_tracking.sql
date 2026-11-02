-- Tracking de operaciones Comex: tablas, permisos, sincronización y alertas.
-- Va en la MISMA base de Supabase que el sistema de stock (proyecto
-- "sistema-stock"), en tablas propias con prefijo op_. No toca ninguna
-- tabla del sistema de stock: solo LEE calidad para el control de apto.
--
-- Ejecutar una vez en Supabase > SQL Editor. Antes, reemplazar el token
-- de la sección 2 por una frase larga inventada (la misma va después en
-- el Apps Script de sincronización).

-- =========================================================
-- 1. Tablas
-- =========================================================

-- Quién puede entrar a la app y con qué permiso.
create table if not exists public.op_usuarios (
  email text primary key,                 -- en minúsculas
  rol text not null check (rol in ('editor', 'lectura')),
  responsable text check (responsable in ('lourdes', 'valentina'))
);

-- Una fila por CV y lote (26-115A, 26-118).
create table if not exists public.op_operaciones (
  clave text primary key,
  cv text not null,
  lote text,
  cliente text,
  broker text,
  silver boolean not null default false,
  destino text,
  producto text,
  tn numeric(12, 3),
  responsable text check (responsable in ('lourdes', 'valentina')),
  payment_terms text,
  fecha_contrato date,          -- VENTAS: Fecha (si no está firmado, las alertas cuentan desde acá)
  tipo_bl text,
  booking text,
  contenedores text,
  fecha_carga_planta date,      -- PROYECCION CARGAS: Fecha de carga
  fecha_consolidado date,       -- PROYECCION CARGAS: Fecha de consolidado (prevista)
  corte_documental date,
  lugar_carga text,             -- PROYECCION CARGAS: Dónde se carga
  deposito text,
  etd date,
  eta date,
  activa boolean not null default true,
  sincronizada_at timestamptz,
  created_at timestamptz not null default now()
);

-- Un paso hecho de una operación. fecha null = hecho, sin fecha conocida.
alter table public.op_operaciones add column if not exists fecha_contrato date;
alter table public.op_operaciones add column if not exists lugar_carga text;
alter table public.op_operaciones add column if not exists deposito text;

create table if not exists public.op_hitos (
  clave text not null references public.op_operaciones (clave) on delete cascade,
  paso text not null,
  fecha date,
  fuente text not null default 'manual'
    check (fuente in ('manual', 'mail', 'ventas', 'seguimiento', 'proyeccion', 'pagos_fletes', 'cobranzas')),
  detalle text,
  mail_url text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (clave, paso)
);

create table if not exists public.op_config (
  clave text primary key,
  valor text not null
);

-- =========================================================
-- 2. Token de sincronización (REEMPLAZAR antes de ejecutar)
-- =========================================================
insert into public.op_config (clave, valor)
values ('token_sync', 'REEMPLAZAR-POR-UNA-FRASE-LARGA-Y-SECRETA')
on conflict (clave) do update set valor = excluded.valor;

-- El control de calidad (cocción, hidratación, apto) arrancó el 29/10/2026:
-- los retiros anteriores no alertan por falta de Apto.
insert into public.op_config (clave, valor) values ('inicio_control_calidad', '2026-10-29')
on conflict (clave) do nothing;

insert into public.op_usuarios (email, rol, responsable) values
  ('valentinahastun@argreen.com.ar', 'editor', 'valentina'),
  ('lourdesfioretti@argreen.com.ar', 'editor', 'lourdes')
on conflict (email) do nothing;

-- =========================================================
-- 3. Permisos
-- =========================================================
create or replace function public.op_rol()
returns text
language sql
security definer set search_path = public
stable
as $$
  select rol from public.op_usuarios
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

alter table public.op_usuarios enable row level security;
alter table public.op_operaciones enable row level security;
alter table public.op_hitos enable row level security;
alter table public.op_config enable row level security;   -- sin políticas: nadie la lee por la API

drop policy if exists "op ver usuarios" on public.op_usuarios;
create policy "op ver usuarios" on public.op_usuarios
  for select using (public.op_rol() is not null);

drop policy if exists "op ver operaciones" on public.op_operaciones;
create policy "op ver operaciones" on public.op_operaciones
  for select using (public.op_rol() is not null);
drop policy if exists "op editar operaciones" on public.op_operaciones;
create policy "op editar operaciones" on public.op_operaciones
  for update using (public.op_rol() = 'editor') with check (public.op_rol() = 'editor');

drop policy if exists "op ver hitos" on public.op_hitos;
create policy "op ver hitos" on public.op_hitos
  for select using (public.op_rol() is not null);
drop policy if exists "op cargar hitos" on public.op_hitos;
create policy "op cargar hitos" on public.op_hitos
  for insert with check (public.op_rol() = 'editor');
drop policy if exists "op editar hitos" on public.op_hitos;
create policy "op editar hitos" on public.op_hitos
  for update using (public.op_rol() = 'editor') with check (public.op_rol() = 'editor');
drop policy if exists "op borrar hitos" on public.op_hitos;
create policy "op borrar hitos" on public.op_hitos
  for delete using (public.op_rol() = 'editor');

-- =========================================================
-- 4. Utilidades
-- =========================================================
create or replace function public.op_norm_cv(t text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(regexp_replace(coalesce(t, ''), '^\s*cv', '', 'i'), '[^0-9A-Za-z-]', '', 'g')), '');
$$;

create or replace function public.op_hoy()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date; $$;

-- ¿El CV tiene al menos un análisis Apto en calidad (sistema de stock)?
create or replace function public.op_tiene_apto(p_clave text, p_cv text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.registros_calidad rc
    where rc.apto is true
      and public.op_norm_cv(rc.numero_contrato) in (p_clave, p_cv)
  ) or exists (
    select 1
    from public.registros_calidad rc
    join public.imputaciones i on i.lote_id = rc.lote_id
    join public.lineas_contrato lc on lc.id = i.linea_contrato_id
    join public.contratos c on c.id = lc.contrato_id
    where rc.apto is true
      and public.op_norm_cv(c.numero) in (p_clave, p_cv)
  );
$$;

-- =========================================================
-- 5. Sincronización desde las planillas (la llama el Apps Script)
-- =========================================================
-- p_ops:   [{clave, cv, lote, cliente, broker, silver, destino, producto, tn,
--            responsable, payment_terms, fecha_contrato, tipo_bl, booking, contenedores,
--            fecha_carga_planta, fecha_consolidado, corte_documental, etd, eta}]
-- p_hitos: [{clave, paso, fecha (yyyy-mm-dd o null), fuente, detalle}]
-- Reglas:
--   * Las operaciones que no vienen quedan inactivas (cobradas o fuera de alcance).
--   * Nunca pisa un paso cargado a mano o desde un mail.
--   * Un paso sin fecha en la planilla toma la fecha de hoy si la operación ya
--     se había sincronizado antes (o sea: es la fecha en que se detectó el cambio).
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

-- =========================================================
-- 6. Alertas
-- =========================================================
-- nivel: 'vencida' (hay que hacer algo ya) o 'proxima' (vence en pocos días).
-- en_mail: si va en el mail diario de hoy (el anticipo solo cada 3 días).
create or replace function public.op_calcular_alertas()
returns table (
  clave text, cv text, lote text, cliente text, destino text, responsable text,
  paso text, nivel text, mensaje text, fecha_limite date, en_mail boolean
)
language sql
security definer set search_path = public
stable
as $$
  with o as (
    select op.*,
      coalesce((select fecha from op_hitos h where h.clave = op.clave and h.paso = 'firma'), op.fecha_contrato) as f_firma,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'firma') as firma,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'etiqueta') as etiqueta,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'anticipo') as anticipo,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'ip') as ip,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'retiro') as retiro,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'retiro') as f_retiro,
      -- Ya cargó: los pasos previos a la carga dejan de alertar aunque no estén registrados
      exists (select 1 from op_hitos h where h.clave = op.clave
              and h.paso in ('camiones', 'retiro', 'consolidado', 'draft_enviado', 'originales')) as cargada,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_enviado') as f_draft_env,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'draft_enviado') as draft_env,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_aprobado') as f_draft_ok,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'draft_aprobado') as draft_ok,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'originales') as originales,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'flete') as flete,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'cobranza') as cobranza,
      op_hoy() as hoy
    from op_operaciones op
    where op.activa
  ),
  a as (
    -- Etiqueta: aprobada al menos 2 días antes de la carga en planta
    select o.*, 'etiqueta' as a_paso,
      case when o.hoy > o.fecha_carga_planta - 2 then 'vencida' else 'proxima' end as a_nivel,
      'Etiqueta sin aprobar: la carga en planta es el ' || to_char(o.fecha_carga_planta, 'DD/MM') as a_msg,
      o.fecha_carga_planta - 2 as a_lim, true as a_mail
    from o where not o.etiqueta and not o.cargada and o.fecha_carga_planta is not null
      and o.hoy >= o.fecha_carga_planta - 5
    union all
    -- Anticipo: recordatorio cada 3 días desde la firma
    select o.*, 'anticipo', 'vencida',
      'Consultar anticipo: ' || (o.hoy - o.f_firma) || ' días desde la firma del contrato',
      o.f_firma + 3, ((o.hoy - o.f_firma) % 3 = 0)
    from o where not o.anticipo and not o.cargada and o.f_firma is not null
      and coalesce(o.payment_terms, '') ~* '(anticip|advance|adelant|previo)'
      and o.hoy - o.f_firma >= 3
    union all
    -- IP: 7 días desde la firma (solo destinos que lo piden)
    select o.*, 'ip',
      case when o.hoy > o.f_firma + 7 then 'vencida' else 'proxima' end,
      'IP sin emitir: ' || (o.hoy - o.f_firma) || ' días desde la firma del contrato',
      o.f_firma + 7, true
    from o where not o.ip and not o.cargada and o.f_firma is not null
      and coalesce(o.destino, '') ~* '(pakist|karachi|filipin|manila|venezuel|cabello|colombia|buenaventura|cartagena)'
      and o.hoy >= o.f_firma + 5
    union all
    -- Contenedores retirados con el lote sin Apto en calidad
    select o.*, 'retiro', 'vencida',
      'Contenedores retirados y el lote todavía no está Apto en calidad',
      null::date, true
    from o where o.retiro and not o.cobranza
      and o.f_retiro >= (select valor::date from op_config where op_config.clave = 'inicio_control_calidad')
      and not op_tiene_apto(o.clave, o.cv)
      and not exists (select 1 from op_hitos h where h.clave = o.clave and h.paso = 'consolidado')
    union all
    -- Draft BL: 2 días sin respuesta del cliente
    select o.*, 'draft_aprobado', 'vencida',
      'Draft BL sin respuesta del cliente hace ' || (o.hoy - o.f_draft_env) || ' días',
      o.f_draft_env + 2, true
    from o where o.draft_env and not o.draft_ok and o.f_draft_env is not null
      and o.hoy - o.f_draft_env >= 2
    union all
    -- Originales: 4 días desde la aprobación de drafts
    select o.*, 'originales',
      case when o.hoy - o.f_draft_ok >= 4 then 'vencida' else 'proxima' end,
      'Originales sin emitir: ' || (o.hoy - o.f_draft_ok) || ' días desde la aprobación de drafts',
      o.f_draft_ok + 4, true
    from o where o.draft_ok and not o.originales and o.f_draft_ok is not null
      and o.hoy - o.f_draft_ok >= 2
    union all
    -- Flete: 15 / 10 / 5 días antes del ETA según tipo de BL (igual que PAGOS FLETES)
    select * from (
      select o.*, 'flete' as a_paso,
        case when o.hoy > o.eta - d.dias then 'vencida' else 'proxima' end as a_nivel,
        'Pedir pago de flete: ETA ' || to_char(o.eta, 'DD/MM') || ', BL ' || coalesce(nullif(trim(o.tipo_bl), ''), 'sin dato') as a_msg,
        o.eta - d.dias as a_lim, true as a_mail
      from o
      cross join lateral (select case
          when coalesce(o.tipo_bl, '') ~* 'telex' then 5
          when coalesce(o.tipo_bl, '') ~* 'destino' then 10
          when coalesce(o.tipo_bl, '') ~* 'origin' then 15
          else 10 end as dias) d
      where not o.flete and o.eta is not null and o.hoy >= o.eta - d.dias - 3
    ) f
    union all
    -- Cobranza: 10 días antes del arribo
    select o.*, 'cobranza',
      case when o.hoy > o.eta - 10 then 'vencida' else 'proxima' end,
      'Cobranza pendiente: ETA ' || to_char(o.eta, 'DD/MM'),
      o.eta - 10, true
    from o where not o.cobranza and o.eta is not null and o.hoy >= o.eta - 13
  )
  select a.clave, a.cv, a.lote, a.cliente, a.destino, a.responsable,
         a.a_paso, a.a_nivel, a.a_msg, a.a_lim, a.a_mail
  from a
  order by case a.a_nivel when 'vencida' then 0 else 1 end, a.a_lim nulls first, a.clave;
$$;

revoke all on function public.op_calcular_alertas() from public;

-- Para la app: solo usuarios con acceso al tracking.
create or replace function public.op_alertas()
returns table (
  clave text, cv text, lote text, cliente text, destino text, responsable text,
  paso text, nivel text, mensaje text, fecha_limite date, en_mail boolean
)
language sql
security definer set search_path = public
stable
as $$
  select * from public.op_calcular_alertas() where public.op_rol() is not null;
$$;
revoke all on function public.op_alertas() from public;
grant execute on function public.op_alertas() to authenticated;

-- Para el mail diario del Apps Script (con el token de sincronización).
create or replace function public.op_alertas_token(p_token text)
returns table (
  clave text, cv text, lote text, cliente text, destino text, responsable text,
  paso text, nivel text, mensaje text, fecha_limite date, en_mail boolean
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if p_token is null or p_token <> (select valor from op_config where op_config.clave = 'token_sync') then
    raise exception 'no autorizado';
  end if;
  return query select * from public.op_calcular_alertas();
end;
$$;
revoke all on function public.op_alertas_token(text) from public;
grant execute on function public.op_alertas_token(text) to anon, authenticated;

-- =========================================================
-- 7. Supabase habilita por defecto toda función nueva para anon y
--    authenticated. Se cierra explícitamente lo que no tiene que ser público.
-- =========================================================
revoke execute on function public.op_calcular_alertas() from anon, authenticated;
revoke execute on function public.op_tiene_apto(text, text) from anon, authenticated;
revoke execute on function public.op_alertas() from anon;
