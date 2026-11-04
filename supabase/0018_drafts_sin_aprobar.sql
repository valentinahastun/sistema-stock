-- Drafts que no están aprobados: 26-127 (aprobó solo el BL), 26-115 A (pidió cambios en el CO), 26-113 (pidió modificaciones)
delete from public.op_hitos where clave in ('26-127', '26-115A', '26-113') and paso = 'draft_aprobado';
