-- 26-127: los drafts no están aprobados (el cliente aprobó solo el BL y pidió correcciones)
delete from public.op_hitos where clave = '26-127' and paso = 'draft_aprobado';
