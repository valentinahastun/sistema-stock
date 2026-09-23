-- Para el movimiento "directo", además de la cantidad cargada (que ya
-- usaba la columna "cantidad", igual que ingreso/egreso), se guarda
-- también la cantidad descargada que figura en la CP, para poder ver
-- si hubo diferencia entre lo que salió y lo que llegó incluso en una
-- compra-venta que nunca pasó por el depósito propio. Es opcional:
-- puede que todavía no esté descargada cuando se carga el movimiento.

alter table public.movimientos_stock
  add column if not exists cantidad_descargada numeric(12, 3) check (cantidad_descargada is null or cantidad_descargada > 0);
