-- Movimiento "directo": compra y venta que nunca pasa por el depósito
-- propio (no queda stock de ningún lado). Es un tercer tipo de
-- movimiento, además de ingreso/descarte/egreso: no toca ninguna planta,
-- no resta ni suma stock, solo queda registrado (producto, cantidad, CP,
-- transporte) junto con titular/productor/destino tal como figuran en la
-- Carta de Porte, a modo de trazabilidad.
--
-- También agrega "destino" para egreso (a dónde va la mercadería según la
-- CP, solo a modo de registro, igual que transportista/chofer/patente:
-- nunca se usa para elegir planta).

alter table public.movimientos_stock
  drop constraint if exists movimientos_stock_tipo_check;

alter table public.movimientos_stock
  add constraint movimientos_stock_tipo_check
  check (tipo in ('ingreso', 'descarte', 'egreso', 'directo'));

alter table public.movimientos_stock
  add column if not exists destino text,
  add column if not exists titular text,
  add column if not exists productor_texto text;

-- Ingreso y descarte: siguen necesitando lote_id. Egreso: lote_id, o
-- planta_id + producto_id (como ya estaba). Directo: no necesita ni
-- lote_id ni planta_id, pero sí producto_id (para saber qué se movió).
alter table public.movimientos_stock
  drop constraint if exists movimientos_stock_origen_check;

alter table public.movimientos_stock
  add constraint movimientos_stock_origen_check
  check (
    lote_id is not null
    or (tipo = 'egreso' and planta_id is not null and producto_id is not null)
    or (tipo = 'directo' and producto_id is not null)
  );
