-- 0023: "Camiones cargados" muestra todas las CP de la carpeta, no solo la primera

-- p_items:    [{clave, paso, fecha (yyyy-mm-dd), detalle, url}]
-- p_carpetas: [{clave, url}]
-- Nunca pisa lo cargado a mano ni lo que vino del mail; si ya venía de Drive,
-- deja la fecha más vieja.
create or replace function public.op_drive(p_token text, p_items jsonb, p_carpetas jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_hitos int;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  update op_operaciones o set carpeta_url = c.url
  from jsonb_to_recordset(coalesce(p_carpetas, '[]')) as c(clave text, url text)
  where o.clave = c.clave and o.carpeta_url is distinct from c.url;

  insert into op_hitos as h (clave, paso, fecha, fuente, detalle, mail_url, updated_by, updated_at)
  select distinct on (x.clave, x.paso) x.clave, x.paso, x.fecha, 'drive', left(x.detalle, 500), x.url, 'drive', now()
  from jsonb_to_recordset(coalesce(p_items, '[]')) as x(clave text, paso text, fecha date, detalle text, url text)
  join op_operaciones o on o.clave = x.clave
  order by x.clave, x.paso, x.fecha
  on conflict (clave, paso) do update set
    fecha = case when h.fuente = 'drive' then least(h.fecha, excluded.fecha) else excluded.fecha end,
    fuente = 'drive', detalle = excluded.detalle,
    mail_url = excluded.mail_url, updated_by = 'drive', updated_at = now()
  where h.fuente not in ('manual', 'mail', 'drive')
     or (h.fuente = 'drive' and h.fecha > excluded.fecha)
     -- Camiones: el detalle lleva todas las CP de la carpeta, se actualiza cuando aparece una nueva
     or (h.fuente = 'drive' and excluded.paso = 'camiones' and h.detalle is distinct from excluded.detalle);
  get diagnostics v_hitos = row_count;
  return jsonb_build_object('hitos', v_hitos);
end;
$$;
revoke all on function public.op_drive(text, jsonb, jsonb) from public;
grant execute on function public.op_drive(text, jsonb, jsonb) to anon, authenticated;
