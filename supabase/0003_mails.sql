-- =========================================================
-- Operaciones Comex · Pasos que se leen del mail
-- Ejecutar una vez en Supabase > SQL Editor (después de 0001 y 0002).
-- Se puede volver a ejecutar sin perder datos.
-- =========================================================

-- Cada mail que el script reconoció. Si la regla es segura y la operación
-- existe, el paso se marca solo (estado 'aplicado'). Si no, queda en
-- 'pendiente' y aparece en la pantalla "Por confirmar".
create table if not exists public.op_mails (
  id text primary key,                 -- id del mensaje de Gmail
  fecha timestamptz not null,
  asunto text,
  remitente text,
  url text,
  cv text,                             -- lo que se leyó del mail (ej. 26-116)
  lote text,
  clave text references public.op_operaciones (clave) on delete set null,
  paso text not null,
  motivo text,                         -- por qué se reconoció (o por qué hay que confirmarlo)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'descartado')),
  resuelto_por text,
  resuelto_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists op_mails_estado on public.op_mails (estado, fecha desc);

alter table public.op_mails enable row level security;
drop policy if exists "op ver mails" on public.op_mails;
create policy "op ver mails" on public.op_mails
  for select using (public.op_rol() is not null);
drop policy if exists "op editar mails" on public.op_mails;
create policy "op editar mails" on public.op_mails
  for update using (public.op_rol() = 'editor') with check (public.op_rol() = 'editor');

-- Busca la operación de un CV leído en el mail.
--   26-115 + A  -> 26-115A si existe
--   26-116      -> 26-116, o la única operación con ese CV
-- Si hay varias (por ejemplo lotes A y B sin letra en el mail) devuelve null.
create or replace function public.op_buscar_clave(p_cv text, p_lote text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when exists (select 1 from op_operaciones where clave = p_cv || coalesce(upper(p_lote), ''))
      then p_cv || coalesce(upper(p_lote), '')
    when coalesce(p_lote, '') = '' and (select count(*) from op_operaciones where cv = p_cv) = 1
      then (select clave from op_operaciones where cv = p_cv)
    else null
  end;
$$;
revoke all on function public.op_buscar_clave(text, text) from public, anon, authenticated;

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
              'descartado');
      v_pendientes := v_pendientes + 1;
    end if;
  end loop;

  return jsonb_build_object('nuevos', v_nuevos, 'aplicados', v_aplicados, 'pendientes', v_pendientes);
end;
$$;
revoke all on function public.op_mail(text, jsonb) from public;
grant execute on function public.op_mail(text, jsonb) to anon, authenticated;

-- Desde la pantalla "Por confirmar": confirmar (con la operación y el paso
-- elegidos) o descartar. Solo editoras.
create or replace function public.op_resolver_mail(p_id text, p_accion text, p_clave text, p_paso text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m op_mails;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if op_rol() is distinct from 'editor' then
    raise exception 'Solo Lourdes y Valentina pueden confirmar mails.';
  end if;
  select * into m from op_mails where id = p_id;
  if not found then raise exception 'No encuentro ese mail.'; end if;

  if p_accion = 'descartar' then
    update op_mails set estado = 'descartado', resuelto_por = v_email, resuelto_at = now() where id = p_id;
    return;
  end if;

  if p_accion <> 'confirmar' then raise exception 'Acción inválida.'; end if;
  if not exists (select 1 from op_operaciones where clave = p_clave) then
    raise exception 'Elegí la operación.';
  end if;
  if coalesce(p_paso, '') = '' then raise exception 'Elegí el paso.'; end if;

  -- Confirmado por una persona: queda como cargado a mano.
  insert into op_hitos (clave, paso, fecha, fuente, detalle, mail_url, updated_by, updated_at)
  values (p_clave, p_paso, (m.fecha at time zone 'America/Argentina/Buenos_Aires')::date, 'manual',
          left(m.asunto, 200), m.url, v_email, now())
  on conflict (clave, paso) do update set
    fecha = excluded.fecha, fuente = 'manual', detalle = excluded.detalle,
    mail_url = excluded.mail_url, updated_by = excluded.updated_by, updated_at = now();

  update op_mails set estado = 'aplicado', clave = p_clave, paso = p_paso,
    resuelto_por = v_email, resuelto_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.op_resolver_mail(text, text, text, text) from public, anon;
grant execute on function public.op_resolver_mail(text, text, text, text) to authenticated;
