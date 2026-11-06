-- 26-115 A: todavía no llegaron el fito ni el certificado de origen originales
-- (estaban marcados a mano el 03/11 junto con el resto de los originales).
delete from public.op_hitos
where clave = '26-115A' and paso in ('doc_fito', 'doc_co');
