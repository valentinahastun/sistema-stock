-- 26-129: DDEE recibida, enviada a Batrade el 03/11 ("Adjunto DDEE para su confirmación")
-- y aprobada por el cliente el mismo día ("La declaración está ok").
insert into public.op_hitos (clave, paso, fecha, fuente, detalle, mail_url, updated_by)
select '26-129', x.paso, date '2026-11-03', 'mail', x.detalle, x.url, 'mail'
from (values
  ('ddee_recibida', 'DDEE recibida (antes de que se leyeran estos mails)', null),
  ('ddee_enviada', 'DDEE enviada a logistics@thebatrade.com', 'https://mail.google.com/mail/#all/1a1a130d2f77b73b'),
  ('ddee_aprobada', 'Batrade: "La declaración está ok"', 'https://mail.google.com/mail/#all/1a1a16d3b4b2ff03')
) as x(paso, detalle, url)
where exists (select 1 from public.op_operaciones where clave = '26-129')
on conflict (clave, paso) do nothing;

select paso, fecha, detalle from public.op_hitos where clave = '26-129' and paso like 'ddee%' order by paso;
