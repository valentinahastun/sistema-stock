-- Bucket de Storage para las fotos de calidad, y sus políticas de acceso.
-- Ejecutar en el SQL Editor de Supabase después del 0001_init.sql.

insert into storage.buckets (id, name, public)
values ('calidad-fotos', 'calidad-fotos', true)
on conflict (id) do nothing;

-- Cualquiera con el link puede ver las fotos (el bucket es público),
-- pero solo el administrador puede subir, reemplazar o borrar.
create policy "calidad fotos: subir solo admin"
on storage.objects for insert
with check (bucket_id = 'calidad-fotos' and public.is_admin());

create policy "calidad fotos: actualizar solo admin"
on storage.objects for update
using (bucket_id = 'calidad-fotos' and public.is_admin());

create policy "calidad fotos: borrar solo admin"
on storage.objects for delete
using (bucket_id = 'calidad-fotos' and public.is_admin());
