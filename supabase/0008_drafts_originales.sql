-- Operaciones Comex · cambio 8 (03/11/2026)
-- Documentos en dos listas: drafts (DOCUS EXPO) y originales (Docus Definitivos).
-- "Originales completos" ya no se marca solo por el archivo DOCUMENTOS ORIGINALES:
-- hace falta tener todos los originales (o el scan, o marcarlo a mano).
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

delete from public.op_hitos where paso = 'originales' and fuente = 'drive';

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
      -- Originales completos: marcado (a mano o por el scan) o todos los documentos originales
      (exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'originales')
       or (select count(distinct h.paso) from op_hitos h where h.clave = op.clave
           and h.paso in ('doc_peso', 'doc_fumigacion', 'doc_co', 'doc_fito', 'doc_bl', 'doc_pl', 'doc_factura'))
          = 7) as originales,
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
      'Faltan originales: ' || (o.hoy - o.f_draft_ok) || ' días desde la aprobación de drafts',
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

revoke all on function public.op_calcular_alertas() from public, anon, authenticated;
