-- Drafts que no están aprobados: 26-127 (aprobó solo el BL), 26-115 A (pidió cambios en el CO), 26-113 (pidió modificaciones)
delete from public.op_hitos where clave in ('26-127', '26-115A', '26-113') and paso = 'draft_aprobado';

-- 26-116: lleva anticipo y lleva IP
update public.op_operaciones set pide_anticipo = true, pide_ip = true where clave = '26-116';

-- 26-116: el cliente aprobó los drafts el 03/11 ("aceptan proceder... Quedo atenta al scan de originales")
insert into public.op_hitos (clave, paso, fecha, fuente, detalle, mail_url)
values ('26-116', 'draft_aprobado', '2026-11-03', 'mail', 'El cliente aprobó los drafts (comex@macanaturalfood.com)',
        'https://mail.google.com/mail/#all/1a1a2aca79d70c80')
on conflict (clave, paso) do nothing;
