-- Usuarios de la plataforma (Stock + Calidad + Operaciones).
--   Valentina       Stock: edita · Operaciones: edita
--   Lourdes         Stock: solo mira · Operaciones: edita
--   Nicolás         Stock: solo mira · Operaciones: solo mira
--   Gregorio        Stock: edita · Operaciones: solo mira
-- Los que todavía no tienen cuenta quedan anotados: cuando se los invita,
-- la cuenta nace con su rol de stock.

create table if not exists public.roles_previstos (
  email text primary key,
  rol text not null check (rol in ('admin', 'consulta', 'calidad')),
  nombre text
);
alter table public.roles_previstos enable row level security;

insert into public.roles_previstos (email, rol, nombre) values
  ('lourdesfioretti@argreen.com.ar', 'consulta', 'Lourdes'),
  ('nicolasbrandenburg@argreen.com.ar', 'consulta', 'Nicolás'),
  ('gregorioavellaneda@argreen.com.ar', 'admin', 'Gregorio')
on conflict (email) do update set rol = excluded.rol, nombre = excluded.nombre;

-- Cuenta nueva: perfil con el rol previsto (si no hay, 'consulta' como siempre)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare r record;
begin
  select rol, nombre into r from public.roles_previstos where email = lower(new.email);
  insert into public.profiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', r.nombre), coalesce(r.rol, 'consulta'));
  return new;
end;
$$;

-- Los que ya tienen cuenta: se les ajusta el rol de stock
update public.profiles p
set rol = rp.rol, nombre = coalesce(p.nombre, rp.nombre)
from auth.users u, public.roles_previstos rp
where u.id = p.id and lower(u.email) = rp.email;

-- Operaciones
insert into public.op_usuarios (email, rol, responsable) values
  ('nicolasbrandenburg@argreen.com.ar', 'lectura', null),
  ('gregorioavellaneda@argreen.com.ar', 'lectura', null)
on conflict (email) do update set rol = excluded.rol;

-- Cómo queda
select coalesce(u.email, rp.email) as usuario,
       case when u.id is null then 'falta invitarlo' else 'tiene cuenta' end as cuenta,
       coalesce(p.rol, rp.rol) as stock,
       o.rol as operaciones
from public.roles_previstos rp
full join auth.users u on lower(u.email) = rp.email
left join public.profiles p on p.id = u.id
left join public.op_usuarios o on o.email = lower(coalesce(u.email, rp.email))
order by 1;
