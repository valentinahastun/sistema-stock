-- Sistema de gestión de stock multiplanta (Fase 1: núcleo de stock)
-- Ejecutar en el SQL Editor de tu proyecto Supabase, en orden.

create extension if not exists "pgcrypto";

-- =========================================================
-- 1. Perfiles y roles
-- =========================================================
-- Cada usuario de Supabase Auth tiene un perfil con su rol.
-- rol = 'admin'    -> puede cargar y editar todo (el operador)
-- rol = 'consulta' -> solo lectura (los 4 usuarios de consulta)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  rol text not null default 'consulta' check (rol in ('admin', 'consulta')),
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando se da de alta un usuario en Supabase Auth.
-- Por defecto queda como 'consulta'; el rol de admin se asigna a mano una vez
-- (ver README, paso "Dar de alta al usuario administrador").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, new.raw_user_meta_data ->> 'nombre');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Función helper para las políticas de acceso: ¿el usuario actual es admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select rol = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- =========================================================
-- 2. Catálogos: plantas, productos, productores
-- =========================================================

create table if not exists public.plantas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  ubicacion text,
  created_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.productores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

-- Plantas y productos conocidos hoy, para no arrancar con los catálogos vacíos.
insert into public.plantas (nombre) values
  ('FRACOGA'), ('LEGUCER'), ('BAYA CASAL'), ('ALIMENTOS TROPICALES'), ('CARAM')
on conflict (nombre) do nothing;

insert into public.productos (nombre) values
  ('Poroto Negro'), ('Poroto Alubia'), ('Poroto Cranberry'), ('Poroto Mungo'),
  ('Poroto Adzuki'), ('Poroto Colorado Dark'), ('Poroto Colorado Light'),
  ('Garbanzo'), ('Azúcar')
on conflict (nombre) do nothing;

-- =========================================================
-- 3. Lotes
-- =========================================================
-- El lote se identifica por productor (no hay número de lote propio hoy).
-- estado arranca en 'natural' y pasa a 'procesado' cuando se carga el
-- movimiento de descarte con motivo 'procesamiento' (ver sección 4).

create table if not exists public.lotes (
  id uuid primary key default gen_random_uuid(),
  planta_id uuid not null references public.plantas (id),
  producto_id uuid not null references public.productos (id),
  productor_id uuid not null references public.productores (id),
  estado text not null default 'natural' check (estado in ('natural', 'procesado')),
  numero_cp text,
  fecha_ingreso date not null default current_date,
  cantidad_ingresada numeric(12, 3) not null check (cantidad_ingresada > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists lotes_planta_idx on public.lotes (planta_id);
create index if not exists lotes_producto_idx on public.lotes (producto_id);

-- =========================================================
-- 4. Movimientos de stock
-- =========================================================
-- tipo = 'ingreso'  -> suma al lote (normalmente uno solo, el de alta)
-- tipo = 'descarte' -> resta al lote; motivo 'procesamiento' además marca
--                      el lote como procesado (ver trigger más abajo)
-- tipo = 'egreso'   -> resta al lote; es el único que baja el stock físico
--                      "hacia afuera de la planta"

create table if not exists public.movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.lotes (id),
  tipo text not null check (tipo in ('ingreso', 'descarte', 'egreso')),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  fecha date not null default current_date,
  motivo text,
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists movimientos_lote_idx on public.movimientos_stock (lote_id);
create index if not exists movimientos_tipo_idx on public.movimientos_stock (tipo);

-- Si el descarte es por procesamiento, el lote pasa a estado 'procesado'.
create or replace function public.handle_descarte_procesamiento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.tipo = 'descarte' and new.motivo = 'procesamiento' then
    update public.lotes set estado = 'procesado' where id = new.lote_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_descarte_procesamiento on public.movimientos_stock;
create trigger on_descarte_procesamiento
  after insert on public.movimientos_stock
  for each row execute function public.handle_descarte_procesamiento();

-- =========================================================
-- 5. Calidad
-- =========================================================

create table if not exists public.registros_calidad (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null unique references public.lotes (id),
  pct_bajo_zaranda numeric(5, 2),
  pct_partidos numeric(5, 2),
  pct_arrugados numeric(5, 2),
  pct_otros_granos numeric(5, 2),
  fotos text[] default '{}',
  fecha date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- =========================================================
-- 6. Contratos (se sincronizan desde la solapa VENTAS, ver Fase 3)
-- =========================================================

create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  cliente text,
  fecha date,
  destino text,
  created_at timestamptz not null default now()
);

create table if not exists public.lineas_contrato (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos (id) on delete cascade,
  producto_id uuid references public.productos (id),
  cantidad_pactada numeric(12, 3) not null,
  clave_natural text not null unique, -- numero de contrato + producto, para el sync
  created_at timestamptz not null default now()
);

create table if not exists public.imputaciones (
  id uuid primary key default gen_random_uuid(),
  linea_contrato_id uuid not null references public.lineas_contrato (id),
  lote_id uuid not null references public.lotes (id),
  cantidad_imputada numeric(12, 3) not null check (cantidad_imputada > 0),
  fecha date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- =========================================================
-- 7. Vista de stock consolidado (lo que alimenta el panel)
-- =========================================================

create or replace view public.stock_consolidado as
select
  l.planta_id,
  p.nombre as planta,
  l.producto_id,
  pr.nombre as producto,
  sum(case when m.tipo = 'ingreso' then m.cantidad else 0 end)
    - sum(case when m.tipo = 'descarte' then m.cantidad else 0 end)
    - sum(case when m.tipo = 'egreso' then m.cantidad else 0 end) as stock_disponible_tn
from public.lotes l
join public.plantas p on p.id = l.planta_id
join public.productos pr on pr.id = l.producto_id
left join public.movimientos_stock m on m.lote_id = l.id
group by l.planta_id, p.nombre, l.producto_id, pr.nombre;

create or replace view public.stock_comprometido as
select
  l.planta_id,
  l.producto_id,
  sum(i.cantidad_imputada) as toneladas_comprometidas
from public.imputaciones i
join public.lotes l on l.id = i.lote_id
group by l.planta_id, l.producto_id;

-- =========================================================
-- 8. RLS: consulta lee todo, sólo admin escribe
-- =========================================================

alter table public.profiles enable row level security;
alter table public.plantas enable row level security;
alter table public.productos enable row level security;
alter table public.productores enable row level security;
alter table public.lotes enable row level security;
alter table public.movimientos_stock enable row level security;
alter table public.registros_calidad enable row level security;
alter table public.contratos enable row level security;
alter table public.lineas_contrato enable row level security;
alter table public.imputaciones enable row level security;

create policy "lectura para cualquier usuario logueado" on public.profiles
  for select using (auth.role() = 'authenticated');

-- Patrón repetido para cada tabla de datos: SELECT abierto a cualquier
-- usuario logueado, escritura (INSERT/UPDATE/DELETE) sólo para admin.
do $$
declare
  t text;
begin
  foreach t in array array[
    'plantas', 'productos', 'productores', 'lotes', 'movimientos_stock',
    'registros_calidad', 'contratos', 'lineas_contrato', 'imputaciones'
  ]
  loop
    execute format(
      'create policy "lectura autenticados" on public.%I for select using (auth.role() = ''authenticated'');',
      t
    );
    execute format(
      'create policy "escritura solo admin" on public.%I for all using (public.is_admin()) with check (public.is_admin());',
      t
    );
  end loop;
end $$;
