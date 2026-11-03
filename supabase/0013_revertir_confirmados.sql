-- Operaciones Comex · cambio 13 (03/11/2026)
-- Revierte TODOS los pasos que quedaron marcados por una confirmación de mail
-- ("Por confirmar"). Después, al volver a leer el mail, las reglas actuales
-- marcan los que correspondan (por ejemplo "Documentos aprobados" a Reymar o
-- "ENVIO DOCUMENTACIÓN").

with confirmados as (
  select distinct m.clave, m.paso
  from public.op_mails m
  join public.op_hitos h on h.clave = m.clave and h.paso = m.paso and h.fuente = 'manual'
  where m.estado = 'aplicado' and coalesce(m.resuelto_por, '') <> 'mail'
),
borrados as (
  delete from public.op_hitos h
  using confirmados c
  where h.clave = c.clave and h.paso = c.paso and h.fuente = 'manual'
  returning h.clave, h.paso
)
-- Se liberan los mails de esos pasos para que el script los vuelva a leer
delete from public.op_mails m
using borrados b
where m.clave = b.clave and m.paso = b.paso;
