-- Operaciones Comex · cambio 4 (02/11/2026)
-- Los mails de operaciones que no están en el tracking (ya cobradas o fuera de lo
-- que se sigue) ya no van a "Por confirmar". Limpia los que quedaron pendientes.
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.

-- Lo llama el Apps Script con el token de sincronización.
-- p_items: [{id, fecha, asunto, remitente, url, cv, lote, paso, seguro, motivo}]
-- Un mail ya registrado no se vuelve a procesar (aunque se haya descartado).
-- Al marcar un paso desde el mail:
--   - nunca pisa lo cargado a mano;
--   - si ya estaba marcado por otro mail, deja la fecha más vieja;
--   - si venía de las planillas, lo reemplaza (el mail tiene la fecha real).
create or replace function public.op_mail(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_clave text;
  v_nuevos int := 0;
  v_aplicados int := 0;
  v_pendientes int := 0;
begin
  if p_token is null or p_token <> (select valor from op_config where clave = 'token_sync') then
    raise exception 'token inválido';
  end if;

  for r in
    select * from jsonb_to_recordset(p_items) as x(
      id text, fecha timestamptz, asunto text, remitente text, url text,
      cv text, lote text, cv_alt text, paso text, seguro boolean, motivo text)
  loop
    if r.id is null or r.paso is null or exists (select 1 from op_mails where id = r.id) then
      continue;
    end if;
    v_nuevos := v_nuevos + 1;
    v_clave := case when r.cv is null then null else op_buscar_clave(r.cv, nullif(r.lote, '')) end;
    if v_clave is null and r.cv_alt is not null then
      v_clave := op_buscar_clave(r.cv_alt, nullif(r.lote, ''));
    end if;

    if coalesce(r.seguro, false) and v_clave is not null then
      insert into op_hitos as h (clave, paso, fecha, fuente, detalle, mail_url, updated_by, updated_at)
      values (v_clave, r.paso, (r.fecha at time zone 'America/Argentina/Buenos_Aires')::date, 'mail',
              left(r.asunto, 200), r.url, 'mail', now())
      on conflict (clave, paso) do update set
        fecha = excluded.fecha, fuente = 'mail', detalle = excluded.detalle,
        mail_url = excluded.mail_url, updated_by = 'mail', updated_at = now()
      where h.fuente not in ('manual', 'mail')
         or (h.fuente = 'mail' and h.fecha > excluded.fecha);
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado, resuelto_por, resuelto_at)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), v_clave, r.paso, r.motivo,
              'aplicado', 'mail', now());
      v_aplicados := v_aplicados + 1;
    elsif r.cv is not null
      and not exists (select 1 from op_operaciones where cv in (r.cv, coalesce(r.cv_alt, ''))) then
      -- La operación no está en el tracking (ya cobrada, o fuera de lo que se sigue):
      -- se guarda para no volver a leerlo, pero no se pide confirmar.
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado, resuelto_por, resuelto_at)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), null, r.paso,
              coalesce(r.motivo, '') || ' · operación fuera del tracking (cobrada o no seguida)',
              'descartado', 'mail', now());
    else
      insert into op_mails (id, fecha, asunto, remitente, url, cv, lote, clave, paso, motivo, estado)
      values (r.id, r.fecha, r.asunto, r.remitente, r.url, r.cv, nullif(r.lote, ''), v_clave, r.paso,
              coalesce(r.motivo, '') ||
                case
                  when r.cv is null or v_clave is not null then ''
                  when (select count(*) from op_operaciones where cv = r.cv) > 1 then ' · hay varios lotes de ' || r.cv || ', elegí cuál'
                  else ' · no encontré la operación ' || r.cv || coalesce(r.lote, '')
                end,
              'pendiente');
      v_pendientes := v_pendientes + 1;
    end if;
  end loop;

  return jsonb_build_object('nuevos', v_nuevos, 'aplicados', v_aplicados, 'pendientes', v_pendientes);
end;
$$;
revoke all on function public.op_mail(text, jsonb) from public;
grant execute on function public.op_mail(text, jsonb) to anon, authenticated;

-- Limpieza de los que ya estaban pendientes
update public.op_mails m
set estado = 'descartado', resuelto_por = 'mail', resuelto_at = now(),
    motivo = coalesce(m.motivo, '') || ' · operación fuera del tracking (cobrada o no seguida)'
where m.estado = 'pendiente'
  and m.cv is not null
  and not exists (
    select 1 from public.op_operaciones o
    where o.cv = m.cv
       or o.cv = (lpad(((left(m.cv, 2)::int - 1))::text, 2, '0') || substr(m.cv, 3))
  );
