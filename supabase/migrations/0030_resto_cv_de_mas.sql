-- 0030: diferencia de balanza también cuando a un CV le sale DE MÁS.
-- Ej.: ALINOA, Poroto Negro. Los lotes del 26-112 suman 56,00 y las salidas
-- al 26-112 56,08: esos 80 kg se estaban descontando del lote del 26-138.
-- Ahora, si las salidas de un CV superan sus lotes por hasta 200 kg, la última
-- salida se baja a lo que había (con una nota de lo que decía la CP), y no toca
-- el stock de otros CV. Si le quedan hasta 200 kg, se suman (como en 0029).

create or replace function public.ajustar_resto_cv(p_planta uuid, p_producto uuid, p_cv text)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_dif numeric;  -- lotes - salidas: > 0 sobra, < 0 salió de más
  v_mov uuid;
  v_cant numeric;
begin
  select round(lotes_tn - salidas_tn, 3) into v_dif
  from stock_comprometido_cv
  where planta_id = p_planta and producto_id = p_producto and cv = p_cv and salidas_tn > 0;
  v_dif := coalesce(v_dif, 0);
  if abs(v_dif) <= 0.0005 or abs(v_dif) > 0.2 then
    return 0;
  end if;
  select id, cantidad into v_mov, v_cant
  from movimientos_stock
  where tipo = 'egreso' and lote_id is null and planta_id = p_planta and producto_id = p_producto and cv = p_cv
  order by fecha desc, created_at desc
  limit 1;
  if v_mov is null or v_cant + v_dif <= 0 then
    return 0;
  end if;
  update movimientos_stock
  set cantidad = cantidad + v_dif,
      observaciones = coalesce(observaciones || ' · ', '') ||
        case when v_dif > 0
          then 'Diferencia de balanza: se descontaron también ' || round(v_dif * 1000) || ' kg que quedaban del ' || p_cv || '.'
          else 'Según la CP salieron ' || to_char(v_cant, 'FM999990.000') || ' tn: ' || round(-v_dif * 1000) ||
               ' kg de diferencia de balanza, se descontó lo que quedaba del ' || p_cv || '.'
        end
  where id = v_mov;
  return round(v_dif * 1000);
end;
$$;
revoke all on function public.ajustar_resto_cv(uuid, uuid, text) from public;
grant execute on function public.ajustar_resto_cv(uuid, uuid, text) to authenticated;

-- Lo que ya quedó así: se ajusta ahora y se muestra qué ajustó (kg + sumados a la salida, kg - restados)
select pl.nombre as planta, p.nombre as producto, c.cv,
       round(c.lotes_tn, 3) as lotes_tn, round(c.salidas_tn, 3) as salidas_tn,
       public.ajustar_resto_cv(c.planta_id, c.producto_id, c.cv) as kg_ajustados
from (select * from public.stock_comprometido_cv
      where salidas_tn > 0 and abs(lotes_tn - salidas_tn) > 0.0005 and abs(lotes_tn - salidas_tn) <= 0.2) c
join public.plantas pl on pl.id = c.planta_id
join public.productos p on p.id = c.producto_id
order by 1, 2, 3;
