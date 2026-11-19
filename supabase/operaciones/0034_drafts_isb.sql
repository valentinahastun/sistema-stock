-- 0034: alerta de drafts de ISB.
-- Cuando llega el draft del BL hay que mandárselo a ISB para que haga sus
-- drafts (peso y calidad, fumigación). Avisa:
--   1) si llegó el draft del BL y no se le mandó a ISB (el robot ve el mail
--      nuestro a isbargentina con el draft del BL: paso "bl_a_isb");
--   2) si ya se le mandó y están todos los demás drafts: solo falta ISB.
-- Se apaga cuando llegan los dos drafts de ISB o se mandan los drafts al cliente.

create or replace function public.op_calcular_alertas()
returns table (
  clave text, cv text, lote text, cliente text, destino text, responsable text,
  paso text, nivel text, mensaje text, fecha_limite date, en_mail boolean, mail_url text
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
      (exists (select 1 from op_hitos h where h.clave = op.clave
              and (h.paso in ('camiones', 'retiro', 'consolidado', 'ddee_recibida', 'ddee_enviada', 'ddee_aprobada',
                              'drafts', 'draft_enviado', 'draft_aprobado',
                              'originales', 'flete', 'liberacion_bl', 'envio_docs', 'cobranza', 'cruce', 'descarga')
                   or h.paso like 'dr\_%' or h.paso like 'doc\_%'))
       -- coalesce: sin fecha de consolidado (siempre en los terrestres) daba null y no alertaba nada
       or coalesce(op.fecha_carga_planta < op_hoy(), false)
       or coalesce(op.fecha_consolidado < op_hoy(), false)) as cargada,
      -- Ya consolidó: hay consolidado o cualquier paso posterior, o la fecha de consolidado ya pasó
      (exists (select 1 from op_hitos h where h.clave = op.clave
              and (h.paso in ('consolidado', 'ddee_recibida', 'ddee_enviada', 'ddee_aprobada',
                              'drafts', 'draft_enviado', 'draft_aprobado',
                              'originales', 'flete', 'liberacion_bl', 'envio_docs', 'cobranza')
                   or h.paso like 'dr\_%' or h.paso like 'doc\_%'))
       or coalesce(op.fecha_consolidado < op_hoy(), false)) as consolidada,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_enviado') as f_draft_env,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'draft_enviado') as draft_env,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_aprobado') as f_draft_ok,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'draft_aprobado') as draft_ok,
      -- Originales completos: marcado (a mano o por el scan) o todos los documentos originales
      -- (terrestres: fito, CO, factura, MIC/CRT y PL)
      (exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'originales')
       or (not op_es_terrestre(op.destino) and (select count(distinct h.paso) from op_hitos h where h.clave = op.clave
           and h.paso in ('doc_peso', 'doc_fumigacion', 'doc_co', 'doc_fito', 'doc_bl', 'doc_pl', 'doc_factura'))
          = 7)
       or (op_es_terrestre(op.destino) and (select count(distinct h.paso) from op_hitos h where h.clave = op.clave
           and h.paso in ('doc_fito', 'doc_co', 'doc_factura', 'doc_crt', 'doc_pl'))
          = 5)) as originales,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'flete') as flete,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'proforma') as proforma,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'ddee_recibida') as ddee_recibida,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'ddee_aprobada') as ddee_aprobada,
      -- Draft BL que manda el forwarder (del mail o de la carpeta)
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'dr_bl') as f_draft_bl,
      -- ISB: drafts de peso y calidad y de fumigación; y cuándo se le mandó el draft del BL
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'dr_peso') as dr_peso,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'dr_fumigacion') as dr_fumigacion,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'bl_a_isb') as f_bl_isb,
      (select count(distinct h.paso) from op_hitos h where h.clave = op.clave
        and h.paso in ('dr_co', 'dr_fito', 'dr_bl', 'dr_pl', 'dr_factura')) = 5 as otros_drafts,
      -- GMO: se pide si hay borrador u original de GMO en la operación
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso in ('dr_gmo', 'doc_gmo', 'gmo_requerido')) as pide_gmo,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'doc_gmo') as gmo,
      -- Fito original recibido (el GMO se pide a los 2 días)
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'doc_fito') as f_fito,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'cobranza') as cobranza,
      -- Links a Gmail: el mail con que se mandaron los drafts, o una búsqueda por CV / AG
      (select mail_url from op_hitos h where h.clave = op.clave and h.paso = 'draft_enviado') as url_draft_env,
      coalesce(op.mail_cliente_url, 'https://mail.google.com/mail/#search/subject%3A%22' || op.cv || '%22') as url_cv,
      coalesce(op.mail_forwarder_url, op.mail_cliente_url, 'https://mail.google.com/mail/#search/subject%3A%22' || op.cv || '%22') as url_ffww,
      'https://mail.google.com/mail/#search/subject%3A%22AG%20' || substr(op.cv, 4) || '%22' as url_ag,
      op_es_terrestre(op.destino) as terrestre,
      op_hoy() as hoy
    from op_operaciones op
    where op.activa
  ),
  a as (
    -- Etiqueta: aprobada al menos 2 días antes de la carga en planta
    select o.*, 'etiqueta' as a_paso,
      case when o.hoy > o.fecha_carga_planta - 2 then 'vencida' else 'proxima' end as a_nivel,
      'Etiqueta sin aprobar: la carga en planta es el ' || to_char(o.fecha_carga_planta, 'DD/MM') as a_msg,
      o.fecha_carga_planta - 2 as a_lim, true as a_mail, o.url_cv as a_url
    from o where not o.etiqueta and not o.cargada and o.fecha_carga_planta is not null
      and o.hoy >= o.fecha_carga_planta - 5
    union all
    -- Anticipo: recordatorio cada 3 días desde la firma
    select o.*, 'anticipo', 'vencida',
      'Consultar anticipo: ' || (o.hoy - o.f_firma) || ' días desde la firma del contrato',
      o.f_firma + 3, ((o.hoy - o.f_firma) % 3 = 0), o.url_cv
    from o where not o.anticipo and o.f_firma is not null
      -- Lleva anticipo: marcado a mano, o según las condiciones de pago (estas dejan de alertar si ya cargó)
      and coalesce(o.pide_anticipo, coalesce(o.payment_terms, '') ~* '(anticip|advance|adelant|previo)')
      and (o.pide_anticipo is true or not o.cargada)
      and o.hoy - o.f_firma >= 3
    union all
    -- IP: 7 días desde la firma (solo destinos que lo piden)
    select o.*, 'ip',
      case when o.hoy > o.f_firma + 7 then 'vencida' else 'proxima' end,
      'IP sin emitir: ' || (o.hoy - o.f_firma) || ' días desde la firma del contrato',
      o.f_firma + 7, true, o.url_cv
    from o where not o.ip and o.f_firma is not null
      -- Lleva IP: marcado a mano, o según el destino (este deja de alertar si ya cargó)
      and coalesce(o.pide_ip, coalesce(o.destino, '') ~* '(pakist|karachi|filipin|manila|venezuel|cabello|colombia|buenaventura|cartagena)')
      and (o.pide_ip is true or not o.cargada)
      and o.hoy >= o.f_firma + 5
    union all
    -- Proforma: el día antes del consolidado, si todavía no se envió
    select o.*, 'proforma', 'vencida',
      'Enviar proforma: el consolidado es el ' || to_char(o.fecha_consolidado, 'DD/MM'),
      o.fecha_consolidado - 1, true, null::text
    from o where not o.terrestre and not o.proforma and not o.consolidada and o.fecha_consolidado is not null
      and o.hoy >= o.fecha_consolidado - 1
    union all
    -- Terrestres: proforma y apertura de embarque el día antes de la carga en planta
    select o.*, 'proforma', 'vencida',
      'Enviar proforma y apertura de embarque: la carga en planta es el ' || to_char(o.fecha_carga_planta, 'DD/MM'),
      o.fecha_carga_planta - 1, true, null::text
    from o where o.terrestre and not o.proforma and not o.cargada and o.fecha_carga_planta is not null
      and o.hoy >= o.fecha_carga_planta - 1
    union all
    -- DDEE: Reymar la manda después del consolidado; tiene que estar aprobada antes del corte documental
    select o.*, 'ddee_aprobada',
      case when o.corte_documental is null or o.hoy >= o.corte_documental - 1 then 'vencida' else 'proxima' end,
      'Aprobar DDEE' || coalesce(': corte documental el ' || to_char(o.corte_documental, 'DD/MM'), ''),
      o.corte_documental - 1, true, null::text
    from o where o.ddee_recibida and not o.ddee_aprobada and not o.draft_ok and not o.originales
    union all
    -- Contenedores retirados con el lote sin Apto en calidad
    select o.*, 'retiro', 'vencida',
      'Contenedores retirados y el lote todavía no está Apto en calidad',
      null::date, true, null::text
    from o where o.retiro and not o.cobranza
      and o.f_retiro >= (select valor::date from op_config where op_config.clave = 'inicio_control_calidad')
      and not op_tiene_apto(o.clave, o.cv)
      and not o.consolidada
    union all
    -- Mandar drafts: 2 días después de que el forwarder manda el draft de BL
    select o.*, 'draft_enviado',
      case when o.hoy - o.f_draft_bl >= 2 then 'vencida' else 'proxima' end,
      'Mandar drafts al cliente: el draft de BL llegó hace ' || (o.hoy - o.f_draft_bl) || ' días',
      o.f_draft_bl + 2, true, o.url_cv
    from o where not o.terrestre and not o.draft_env and not o.draft_ok and not o.originales and o.f_draft_bl is not null
      and o.hoy - o.f_draft_bl >= 1
    union all
    -- Consultar aprobación: todos los días desde que se mandaron hasta que se aprueban
    -- ISB: llegó el draft del BL y todavía no se lo mandamos a ISB para que haga sus drafts
    select o.*, 'draft_isb',
      case when o.hoy - o.f_draft_bl >= 1 then 'vencida' else 'proxima' end,
      'Mandar el draft del BL a ISB (llegó el ' || to_char(o.f_draft_bl, 'DD/MM') || '): faltan '
        || concat_ws(' y ', case when not o.dr_peso then 'peso y calidad' end, case when not o.dr_fumigacion then 'fumigación' end),
      o.f_draft_bl + 1, true, o.url_cv
    from o where not o.terrestre and o.f_draft_bl is not null and o.f_bl_isb is null
      and not (o.dr_peso and o.dr_fumigacion) and not o.draft_env and not o.draft_ok and not o.originales
    union all
    -- ISB: ya tiene el draft del BL y están todos los demás drafts; solo faltan los de ISB
    select o.*, 'draft_isb',
      case when o.hoy - o.f_bl_isb >= 1 then 'vencida' else 'proxima' end,
      'Solo faltan los drafts de ISB (' || concat_ws(' y ', case when not o.dr_peso then 'peso y calidad' end,
        case when not o.dr_fumigacion then 'fumigación' end) || '): el BL se les mandó el ' || to_char(o.f_bl_isb, 'DD/MM'),
      o.f_bl_isb + 1, true, o.url_cv
    from o where not o.terrestre and o.f_bl_isb is not null and o.otros_drafts
      and not (o.dr_peso and o.dr_fumigacion) and not o.draft_env and not o.draft_ok and not o.originales
    union all
    select o.*, 'draft_aprobado', 'vencida',
      'Consultar aprobación de drafts: enviados hace ' || (o.hoy - o.f_draft_env) || ' días',
      o.f_draft_env + 1, true, case when o.url_cv like '%#search/subject%' then coalesce(o.url_draft_env, o.url_cv) else o.url_cv end
    from o where not o.terrestre and o.draft_env and not o.draft_ok and not o.originales and o.f_draft_env is not null
      and o.hoy - o.f_draft_env >= 1
    union all
    -- Originales: a las 48 hs de la aprobación de drafts
    select o.*, 'originales',
      case when o.hoy - o.f_draft_ok >= 2 then 'vencida' else 'proxima' end,
      'Faltan originales: ' || (o.hoy - o.f_draft_ok) || ' días desde la aprobación de drafts',
      o.f_draft_ok + 2, true, o.url_ag
    from o where o.draft_ok and not o.originales and o.f_draft_ok is not null
      and o.hoy - o.f_draft_ok >= 1
    union all
    -- GMO: a los 2 días de que llega el fito original, si la operación lo pide
    select o.*, 'gmo',
      case when o.hoy - o.f_fito >= 2 then 'vencida' else 'proxima' end,
      'Falta el GMO original: ' || (o.hoy - o.f_fito) || ' días desde que llegó el fito original',
      o.f_fito + 2, true, o.url_ag
    from o where o.pide_gmo and not o.gmo and o.f_fito is not null
      and o.hoy - o.f_fito >= 1
    union all
    -- Flete: 15 / 10 / 5 días antes del ETA según tipo de BL (igual que PAGOS FLETES)
    select * from (
      select o.*, 'flete' as a_paso,
        case when o.hoy > o.eta - d.dias then 'vencida' else 'proxima' end as a_nivel,
        'Pedir pago de flete: ETA ' || to_char(o.eta, 'DD/MM') || ', BL ' || coalesce(nullif(trim(o.tipo_bl), ''), 'sin dato') as a_msg,
        o.eta - d.dias as a_lim, true as a_mail, o.url_ffww as a_url
      from o
      cross join lateral (select case
          when coalesce(o.tipo_bl, '') ~* 'telex' then 5
          when coalesce(o.tipo_bl, '') ~* 'destino' then 10
          when coalesce(o.tipo_bl, '') ~* 'origin' then 15
          else 10 end as dias) d
      where not o.terrestre and not o.flete and o.eta is not null and o.hoy >= o.eta - d.dias - 3
    ) f
    union all
    -- Cobranza: 10 días antes del arribo
    select o.*, 'cobranza',
      case when o.hoy > o.eta - 10 then 'vencida' else 'proxima' end,
      'Cobranza pendiente: ETA ' || to_char(o.eta, 'DD/MM'),
      o.eta - 10, true, o.url_cv
    from o where not o.cobranza and o.eta is not null and o.hoy >= o.eta - 13
  )
  select a.clave, a.cv, a.lote, a.cliente, a.destino, a.responsable,
         a.a_paso, a.a_nivel, a.a_msg, a.a_lim, a.a_mail, a.a_url
  from a
  order by case a.a_nivel when 'vencida' then 0 else 1 end, a.a_lim nulls first, a.clave;
$$;
