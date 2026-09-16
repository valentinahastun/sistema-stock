-- Permite que el rol 'calidad' también pueda subir fotos al bucket
-- calidad-fotos (antes era exclusivo de admin). Se suma a la política
-- existente, no la reemplaza: insertar sigue permitido si sos admin
-- O si sos calidad. Actualizar y borrar fotos sigue siendo solo admin.
-- Ejecutar en el SQL Editor de Supabase después del 0003_calidad_standalone.sql.

create policy "calidad fotos: subir calidad"
on storage.objects for insert
with check (bucket_id = 'calidad-fotos' and public.rol_actual() = 'calidad');
