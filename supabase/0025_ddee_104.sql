-- 26-104: DDEE enviada a FQ International el 13/10 ("Please find attached the DDEE for this operation")
insert into public.op_hitos (clave, paso, fecha, fuente, detalle, mail_url, updated_by)
select '26-104', 'ddee_enviada', date '2026-10-13', 'mail', 'DDEE enviada a fqdocs123@gmail.com',
       'https://mail.google.com/mail/#all/1a135d0cd8dd8e32', 'mail'
where exists (select 1 from public.op_operaciones where clave = '26-104')
on conflict (clave, paso) do nothing;
