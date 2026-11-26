-- 0040: cambios pedidos por el cliente en los drafts y su reenvío.
-- * El robot marca "draft_modif" cuando el cliente (o el broker) responde en el hilo
--   de los drafts pidiendo correcciones, y "draft_reenviado" cuando el equipo vuelve
--   a mandar los drafts en ese hilo. Si hay varias vueltas, queda la última ("Vuelta N").
-- * Alerta nueva: "El cliente pidió cambios en los drafts el DD/MM: falta reenviarlos"
--   (amarilla el día del pedido, roja desde el día hábil siguiente).
-- * "Consultar aprobación de drafts" no sale mientras falte reenviar, y cuenta desde
--   el último envío.
-- (Incluye lo del 0038 y 0039.)

create or replace function public.op_mail(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_clave text;
  v_nuevos int := 0;
  v_aplicados int := 0;
  v_pendientes int := 0;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  for r in
    select * from jsonb_to_recordset(p_items) as x(
      id text, fecha timestamptz, asunto text, remitente text, url text,
      cv text, lote text, cv_alt text, paso text, seguro boolean, motivo text)
  loop
    if r.id is null or r.paso is null or exists (select 1 from op_mails where id = r.id) then
      continue;
    end if;
    v_nuevos := v_nuevos + 1;
    v_clave := case when r.cv is null then null else op_buscar_clave(r.cv, nullif(r.lote, '')) end;
    if v_clave is null and r.cv_alt is not null then
      v_clave := op_buscar_clave(r.cv_alt, nullif(r.lote, ''));
    end if;

    if coalesce(r.seguro, false) and v_clave is not null then
      -- Cambios pedidos en drafts y reenvíos: puede haber varias vueltas; queda la
      -- última (con su número de vuelta). El resto de los pasos guarda el primero.
      insert into op_hitos as h (clave, paso, fecha, fuente, detalle, mail_url, updated_by, updated_at)
      values (v_clave, r.paso, (r.fecha at time zone 'America/Argentina/Buenos_Aires')::date, 'mail',
              case when r.paso in ('draft_modif', 'draft_reenviado')
                then 'Vuelta ' || (1 + (select count(*) from op_mails m where m.clave = v_clave and m.paso = r.paso and m.estado = 'aplicado'))
                     || ' · ' || left(r.asunto, 180)
                else left(r.asunto, 200) end,
              r.url, 'mail', now())
      on conflict (clave, paso) do update set
        fecha = excluded.fecha, fuente = 'mail', detalle = excluded.detalle,
        mail_url = excluded.mail_url, updated_by = 'mail', updated_at = now()
      where h.fuente not in ('manual', 'mail')
         or (h.fuente = 'mail' and r.paso not in ('draft_modif', 'draft_reenviado') and h.fecha > excluded.fecha)
         or (h.fuente = 'mail' and r.paso in ('draft_modif', 'draft_reenviado') and h.fecha <= excluded.fecha);
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado, resuelto_por, resuelto_at)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), v_clave, r.paso, r.motivo,
              'aplicado', 'mail', now());
      v_aplicados := v_aplicados + 1;
    elsif r.cv is not null
      and not exists (select 1 from op_operaciones where cv in (r.cv, coalesce(r.cv_alt, ''))) then
      -- La operación no está en el tracking (ya cobrada, o fuera de lo que se sigue):
      -- se guarda para no volver a leerlo, pero no se pide confirmar.
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado, resuelto_por, resuelto_at)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), null, r.paso,
              coalesce(r.motivo, '') || ' · operación fuera del tracking (cobrada o no seguida)',
              'descartado', 'mail', now());
    else
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), v_clave, r.paso,
              coalesce(r.motivo, '') ||
                case
                  when r.cv is null or v_clave is not null then ''
                  when (select count(*) from op_operaciones where cv = r.cv) > 1 then ' · hay varios lotes de ' || r.cv || ', elegí cuál'
                  else ' · no encontré la operación ' || r.cv || coalesce(r.lote, '')
                end,
              'descartado');
      v_pendientes := v_pendientes + 1;
    end if;
  end loop;

  return jsonb_build_object('nuevos', v_nuevos, 'aplicados', v_aplicados, 'pendientes', v_pendientes);
end;
$$;
revoke all on function public.op_mail(text, jsonb) from public;
grant execute on function public.op_mail(text, jsonb) to anon, authenticated;


create or replace function public.op_es_control_union(p_destino text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_destino, '') ~* '(argel|alger|bejaia|skikda|annaba)';
$$;

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
                              'drafts', 'draft_enviado', 'draft_aprobado', 'draft_modif', 'draft_reenviado',
                              'originales', 'flete', 'liberacion_bl', 'envio_docs', 'cobranza', 'cruce', 'descarga')
                   or h.paso like 'dr\_%' or h.paso like 'doc\_%'))
       -- coalesce: sin fecha de consolidado (siempre en los terrestres) daba null y no alertaba nada
       or coalesce(op.fecha_carga_planta < op_hoy(), false)
       or coalesce(op.fecha_consolidado < op_hoy(), false)) as cargada,
      -- Ya consolidó: hay consolidado o cualquier paso posterior, o la fecha de consolidado ya pasó
      (exists (select 1 from op_hitos h where h.clave = op.clave
              and (h.paso in ('consolidado', 'ddee_recibida', 'ddee_enviada', 'ddee_aprobada',
                              'drafts', 'draft_enviado', 'draft_aprobado', 'draft_modif', 'draft_reenviado',
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
      -- Solapa ANALISIS de la planilla: análisis de ISB cargado y sus modificaciones (col. D)
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'analisis_isb') as analisis_isb,
      -- fecha en que el robot vio el análisis por primera vez en la solapa
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'analisis_isb') as f_analisis,
      exists (select 1 from op_hitos h where h.clave = op.clave and h.paso = 'analisis_modif') as analisis_modif,
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
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_modif') as f_draft_modif,
      (select fecha from op_hitos h where h.clave = op.clave and h.paso = 'draft_reenviado') as f_draft_reenv,
      (select mail_url from op_hitos h where h.clave = op.clave and h.paso = 'draft_modif') as url_draft_modif,
      (select count(*) from op_mails m where m.clave = op.clave and m.paso = 'draft_modif' and m.estado = 'aplicado') as n_draft_modif,
      (select count(*) from op_mails m where m.clave = op.clave and m.paso = 'draft_reenviado' and m.estado = 'aplicado') as n_draft_reenv,
      coalesce(op.mail_cliente_url, 'https://mail.google.com/mail/#search/subject%3A%22' || op.cv || '%22') as url_cv,
      coalesce(op.mail_forwarder_url, op.mail_cliente_url, 'https://mail.google.com/mail/#search/subject%3A%22' || op.cv || '%22') as url_ffww,
      'https://mail.google.com/mail/#search/subject%3A%22AG%20' || substr(op.cv, 4) || '%22' as url_ag,
      op_es_terrestre(op.destino) as terrestre,
      op_es_control_union(op.destino) as control_union,
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
      'Consultar anticipo: ' || (op_habiles(o.f_firma, o.hoy)) || ' días desde la firma del contrato',
      op_mas_habiles(o.f_firma, 3), ((op_habiles(o.f_firma, o.hoy)) % 3 = 0), o.url_cv
    from o where not o.anticipo and o.f_firma is not null
      -- Lleva anticipo: marcado a mano, o según las condiciones de pago (estas dejan de alertar si ya cargó)
      and coalesce(o.pide_anticipo, coalesce(o.payment_terms, '') ~* '(anticip|advance|adelant|previo)')
      and (o.pide_anticipo is true or not o.cargada)
      and op_habiles(o.f_firma, o.hoy) >= 3
    union all
    -- IP: 7 días desde la firma (solo destinos que lo piden)
    select o.*, 'ip',
      case when op_habiles(o.f_firma, o.hoy) > 7 then 'vencida' else 'proxima' end,
      'IP sin emitir: ' || (op_habiles(o.f_firma, o.hoy)) || ' días desde la firma del contrato',
      op_mas_habiles(o.f_firma, 7), true, o.url_cv
    from o where not o.ip and o.f_firma is not null
      -- Lleva IP: marcado a mano, o según el destino (este deja de alertar si ya cargó)
      and coalesce(o.pide_ip, coalesce(o.destino, '') ~* '(pakist|karachi|filipin|manila|venezuel|cabello|colombia|buenaventura|cartagena)')
      and (o.pide_ip is true or not o.cargada)
      and o.hoy >= op_mas_habiles(o.f_firma, 5)
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
      case when op_habiles(o.f_draft_bl, o.hoy) >= 2 then 'vencida' else 'proxima' end,
      'Mandar drafts al cliente: el draft de BL llegó hace ' || (op_habiles(o.f_draft_bl, o.hoy)) || ' días',
      op_mas_habiles(o.f_draft_bl, 2), true, o.url_cv
    from o where not o.terrestre and not o.draft_env and not o.draft_ok and not o.originales and o.f_draft_bl is not null
      and op_habiles(o.f_draft_bl, o.hoy) >= 1
    union all
    -- Consultar aprobación: todos los días desde que se mandaron hasta que se aprueban
    -- Análisis de ISB cargado en la solapa ANALISIS pero sin las modificaciones (col. D):
    -- sin eso no se pueden mandar los drafts. Amarillo el día que se carga el análisis,
    -- rojo desde el día siguiente (el draft del BL suele llegar antes, no sirve de referencia).
    select o.*, 'analisis_modif',
      case when op_habiles(coalesce(o.f_analisis, o.hoy), o.hoy) >= 1 then 'vencida' else 'proxima' end,
      'Faltan las modificaciones del análisis de ISB',
      op_mas_habiles(coalesce(o.f_analisis, o.hoy), 1), true, o.url_cv
    from o where not o.terrestre and o.analisis_isb and not o.analisis_modif
      and not o.draft_env and not o.draft_ok and not o.originales
    union all
    -- ISB: llegó el draft del BL y todavía no se lo mandamos a ISB para que haga sus drafts
    select o.*, 'draft_isb',
      case when op_habiles(o.f_draft_bl, o.hoy) >= 1 then 'vencida' else 'proxima' end,
      'Mandar el draft del BL a ISB (llegó el ' || to_char(o.f_draft_bl, 'DD/MM') || '): faltan '
        || concat_ws(' y ', case when not o.dr_peso then 'peso y calidad' end, case when not o.dr_fumigacion then 'fumigación' end),
      op_mas_habiles(o.f_draft_bl, 1), true, o.url_cv
    from o where not o.terrestre and not o.control_union and o.f_draft_bl is not null and o.f_bl_isb is null
      and not (o.dr_peso and o.dr_fumigacion) and not o.draft_env and not o.draft_ok and not o.originales
    union all
    -- ISB: ya tiene el draft del BL y están todos los demás drafts; solo faltan los de ISB
    select o.*, 'draft_isb',
      case when op_habiles(o.f_bl_isb, o.hoy) >= 1 then 'vencida' else 'proxima' end,
      'Solo faltan los drafts de ISB (' || concat_ws(' y ', case when not o.dr_peso then 'peso y calidad' end,
        case when not o.dr_fumigacion then 'fumigación' end) || '): el BL se les mandó el ' || to_char(o.f_bl_isb, 'DD/MM'),
      op_mas_habiles(o.f_bl_isb, 1), true, o.url_cv
    from o where not o.terrestre and not o.control_union and o.f_bl_isb is not null and o.otros_drafts
      and not (o.dr_peso and o.dr_fumigacion) and not o.draft_env and not o.draft_ok and not o.originales
    union all
    -- El cliente pidió cambios en los drafts y todavía no se reenviaron
    select o.*, 'draft_modif',
      case when op_habiles(o.f_draft_modif, o.hoy) >= 1 then 'vencida' else 'proxima' end,
      'El cliente pidió cambios en los drafts el ' || to_char(o.f_draft_modif, 'DD/MM') || ': falta reenviarlos',
      op_mas_habiles(o.f_draft_modif, 1), true, coalesce(o.url_draft_modif, o.url_cv)
    from o where not o.terrestre and o.f_draft_modif is not null
      and (o.f_draft_reenv is null or o.f_draft_reenv < o.f_draft_modif
           or (o.f_draft_reenv = o.f_draft_modif and o.n_draft_modif > o.n_draft_reenv))
      and not o.draft_ok and not o.originales
    union all
    -- Consultar aprobación: desde el último envío (o reenvío), y no mientras falte reenviar cambios
    select o.*, 'draft_aprobado', 'vencida',
      'Consultar aprobación de drafts: enviados hace ' || (op_habiles(greatest(o.f_draft_env, o.f_draft_reenv), o.hoy)) || ' días',
      op_mas_habiles(greatest(o.f_draft_env, o.f_draft_reenv), 1), true, case when o.url_cv like '%#search/subject%' then coalesce(o.url_draft_env, o.url_cv) else o.url_cv end
    from o where not o.terrestre and o.draft_env and not o.draft_ok and not o.originales and o.f_draft_env is not null
      and not (o.f_draft_modif is not null and (o.f_draft_reenv is null or o.f_draft_reenv < o.f_draft_modif
                or (o.f_draft_reenv = o.f_draft_modif and o.n_draft_modif > o.n_draft_reenv)))
      and op_habiles(greatest(o.f_draft_env, o.f_draft_reenv), o.hoy) >= 1
    union all
    -- Originales: a las 48 hs de la aprobación de drafts
    select o.*, 'originales',
      case when op_habiles(o.f_draft_ok, o.hoy) >= 2 then 'vencida' else 'proxima' end,
      'Faltan originales: ' || (op_habiles(o.f_draft_ok, o.hoy)) || ' días desde la aprobación de drafts',
      op_mas_habiles(o.f_draft_ok, 2), true, o.url_ag
    from o where o.draft_ok and not o.originales and o.f_draft_ok is not null
      and op_habiles(o.f_draft_ok, o.hoy) >= 1
    union all
    -- GMO: tarda 6 días hábiles desde que llega el fito original. Aviso amarillo
    -- desde el día 5; rojo cuando pasaron más de 6.
    select o.*, 'gmo',
      case when op_habiles(o.f_fito, o.hoy) > 6 then 'vencida' else 'proxima' end,
      'Falta el GMO original: ' || (op_habiles(o.f_fito, o.hoy)) || ' días desde que llegó el fito original',
      op_mas_habiles(o.f_fito, 6), true, o.url_ag
    from o where o.pide_gmo and not o.gmo and o.f_fito is not null
      and op_habiles(o.f_fito, o.hoy) >= 5
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
