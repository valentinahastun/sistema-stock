-- Operaciones Comex · cambio 10 (03/11/2026)
-- En los drafts, la factura Silver va aparte de la factura Argreen.
delete from public.op_hitos where paso = 'dr_factura' and fuente = 'drive' and (detalle ilike '%proforma%' or detalle ilike '%silver%');
