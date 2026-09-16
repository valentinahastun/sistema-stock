-- Fase: carga de calidad en el momento de la carga (rol "calidad").
-- Ejecutar en el SQL Editor de Supabase después del 0002_calidad_storage.sql.
--
-- Qué hace:
--   1. Agrega el rol 'calidad' (además de 'admin' y 'consulta').
--   2. Permite que un registro de calidad exista SIN un lote todavía
--      (para cuando el análisis se hace antes de cargar el ingreso al
--      sistema), guardando en ese caso planta/producto/productor y un
--      número de contrato en texto libre, a la espera de vincularse
--      a un lote más adelante.
--   3. Ajusta los permisos (RLS) para que el rol 'calidad' pueda cargar
--      registros de calidad, pero NO pueda leer ni escribir stock
--      (lotes, movimientos, líneas de contrato, imputaciones).

-- =========================================================
-- 0. Helper: rol del usuario actual (para no repetir el subselect)
-- =========================================================

create or replace function public.rol_actual()
returns text
language sql
security definer set search_path = public
stable
as $$
  select rol from public.profiles where id = auth.uid();
$$;

-- =========================================================
-- 1. Nuevo rol 'calidad'
-- =========================================================

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%rol%';
  if cname is not null then
    execute format('alter table public.profiles drop constraint %I', cname);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_rol_check check (rol in ('admin', 'consulta', 'calidad'));

-- =========================================================
-- 2. registros_calidad: lote_id opcional + datos propios
-- =========================================================

-- Solo se saca el NOT NULL. El "unique" que ya tenía lote_id se deja
-- tal cual: en SQL estándar una columna unique nullable permite
-- cualquier cantidad de filas en NULL (se consideran todas distintas
-- entre sí) y sigue exigiendo como máximo una fila por lote_id no nulo.
-- Eso es exactamente lo que hace falta, y además deja el upsert por
-- lote_id (onConflict) funcionando sin cambios.
alter table public.registros_calidad
  alter column lote_id drop not null;

alter table public.registros_calidad
  add column if not exists planta_id uuid references public.plantas (id),
  add column if not exists producto_id uuid references public.productos (id),
  add column if not exists productor_id uuid references public.productores (id),
  add column if not exists numero_contrato text;

-- =========================================================
-- 3. Permisos: 'calidad' solo puede cargar calidad, nunca stock
-- =========================================================

-- Lectura de stock (lotes, movimientos, contratos-línea, imputaciones):
-- antes era "cualquier autenticado", ahora solo admin y consulta.
drop policy if exists "lectura autenticados" on public.lotes;
create policy "lectura admin y consulta" on public.lotes
  for select using (public.rol_actual() in ('admin', 'consulta'));

drop policy if exists "lectura autenticados" on public.movimientos_stock;
create policy "lectura admin y consulta" on public.movimientos_stock
  for select using (public.rol_actual() in ('admin', 'consulta'));

drop policy if exists "lectura autenticados" on public.lineas_contrato;
create policy "lectura admin y consulta" on public.lineas_contrato
  for select using (public.rol_actual() in ('admin', 'consulta'));

drop policy if exists "lectura autenticados" on public.imputaciones;
create policy "lectura admin y consulta" on public.imputaciones
  for select using (public.rol_actual() in ('admin', 'consulta'));

-- plantas, productos, productores y contratos siguen con lectura abierta:
-- son catálogos (no datos de stock) y 'calidad' los necesita para los
-- combos del formulario.

-- Escritura de registros_calidad: antes solo admin. Ahora admin sigue
-- pudiendo todo, y 'calidad' puede insertar y editar sus propios
-- registros (no borrar, no tocar los de otro usuario).
drop policy if exists "escritura solo admin" on public.registros_calidad;

create policy "escritura admin" on public.registros_calidad
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "calidad puede cargar" on public.registros_calidad
  for insert
  with check (public.rol_actual() = 'calidad');

create policy "calidad puede editar lo propio" on public.registros_calidad
  for update
  using (public.rol_actual() = 'calidad' and created_by = auth.uid())
  with check (public.rol_actual() = 'calidad' and created_by = auth.uid());
