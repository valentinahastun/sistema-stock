-- Operaciones Comex · cambio 5 (02/11/2026)
-- Fecha real del booking: el script busca en el mail el primer correo que nombra
-- el número de booking. Esta función le dice qué operaciones revisar.
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

create or replace function public.op_bookings_token(p_token text)
returns table (clave text, booking text)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if p_token is null or p_token <> (select valor from op_config where op_config.clave = 'token_sync') then
    raise exception 'token inválido';
  end if;
  return query
    select o.clave, o.booking
    from op_operaciones o
    left join op_hitos h on h.clave = o.clave and h.paso = 'booking'
    where o.activa
      and coalesce(trim(o.booking), '') <> ''
      and coalesce(h.fuente, '') not in ('manual', 'mail')
    order by o.clave;
end;
$$;
revoke all on function public.op_bookings_token(text) from public;
grant execute on function public.op_bookings_token(text) to anon, authenticated;
