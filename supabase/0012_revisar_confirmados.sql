-- Operaciones Comex · cambio 12 (03/11/2026)
-- 1) Los mails que se habían confirmado a mano en "Por confirmar" y cuyo paso ya se
--    borró vuelven a quedar libres, para que el script los lea de nuevo con las
--    reglas actuales.
-- 2) Lista de los pasos que siguen marcados por una confirmación de mail, para revisarlos.

delete from public.op_mails m
where m.estado = 'aplicado' and coalesce(m.resuelto_por, '') <> 'mail'
  and not exists (select 1 from public.op_hitos h where h.clave = m.clave and h.paso = m.paso);

select
  m.clave as operacion,
  case m.paso
    when 'firma' then 'Contrato firmado' when 'etiqueta' then 'Etiqueta aprobada'
    when 'anticipo' then 'Anticipo cobrado' when 'ip' then 'IP emitido'
    when 'booking' then 'Booking confirmado' when 'camiones' then 'Camiones cargados'
    when 'retiro' then 'Contenedores retirados' when 'consolidado' then 'Consolidado'
    when 'ddee' then 'DDEE aprobada' when 'draft_enviado' then 'Drafts enviados'
    when 'draft_aprobado' then 'Drafts aprobados' when 'originales' then 'Originales completos'
    when 'flete' then 'Pago de flete' when 'liberacion_bl' then 'Liberación del BL'
    when 'envio_docs' then 'Envío de documentos' when 'cobranza' then 'Cobranza'
    else m.paso end as paso,
  to_char(h.fecha, 'DD/MM/YYYY') as fecha,
  split_part(m.resuelto_por, '@', 1) as confirmo,
  m.asunto as mail,
  m.remitente as de
from public.op_mails m
join public.op_hitos h on h.clave = m.clave and h.paso = m.paso and h.fuente = 'manual'
where m.estado = 'aplicado' and coalesce(m.resuelto_por, '') <> 'mail'
order by m.clave, m.paso;
