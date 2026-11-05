-- 26-115 A: MACA aprobó los drafts el 04/11 ("Documento revisado, los datos se encuentran ok
-- salvo la fecha de la factura de GSI ... Proceder luego de esa modificación")
insert into public.op_hitos as h (clave, paso, fecha, fuente, detalle, mail_url, updated_by)
select o.clave, 'draft_aprobado', date '2026-11-04', 'mail',
       'MACA: datos ok, corregir fecha de factura GSI (22/10) y proceder',
       'https://mail.google.com/mail/#all/1a1a7f02b41d5c3a', 'mail'
from public.op_operaciones o
where o.clave in ('26-115A', '26-115 A')
on conflict (clave, paso) do nothing;

select clave, paso, fecha, detalle from public.op_hitos where clave like '26-115%' and paso = 'draft_aprobado';
