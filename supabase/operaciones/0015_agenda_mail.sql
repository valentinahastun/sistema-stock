-- Operaciones Comex · cambio 15 (04/11/2026)
-- Agenda de hoy y mañana para el mail diario: cargas en planta, consolidados y cortes documentales.
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

create or replace function public.op_agenda_token(p_token text, p_dias int default 1)
returns table (
  dia date, tipo text, clave text, cv text, lote text, cliente text, destino text, responsable text
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if p_token is null or p_token <> (select valor from op_config where op_config.clave = 'token_sync') then
    raise exception 'no autorizado';
  end if;
  return query
    select e.dia, e.tipo, o.clave, o.cv, o.lote, o.cliente, o.destino, o.responsable
    from op_operaciones o
    cross join lateral (values
      (o.fecha_carga_planta, 'carga'),
      (o.fecha_consolidado, 'consolidado'),
      (o.corte_documental, 'corte')
    ) as e(dia, tipo)
    where o.activa and e.dia between op_hoy() and op_hoy() + p_dias
    order by e.dia, e.tipo, o.clave;
end;
$$;
revoke all on function public.op_agenda_token(text, int) from public;
grant execute on function public.op_agenda_token(text, int) to anon, authenticated;
