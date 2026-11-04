-- Operaciones Comex · cambio 9 (03/11/2026)
-- La proforma no cuenta como factura en los drafts.
delete from public.op_hitos where paso = 'dr_factura' and fuente = 'drive' and detalle ilike '%proforma%';
