-- 0036: la cobranza se marcaba con SEGUIMIENTO col. AX, que ahora es "Fecha de Factura".
-- Se borran esas marcas; el robot la toma de COBRANZAS (col. S, Fecha de Cobro).
delete from op_hitos
where paso = 'cobranza' and fuente = 'seguimiento';

-- Segunda parte: por un rato el robot tomó la "Fecha de Cobro" (col. S) de COBRANZAS, que
-- puede estar cargada aunque la operación siga PENDIENTE. Ahora solo cuenta el estado COBRADO.
delete from op_hitos
where paso = 'cobranza' and fuente = 'cobranzas';
