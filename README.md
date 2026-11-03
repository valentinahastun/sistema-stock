# Operaciones Comex

App web para seguir cada operación de exportación de Argreen paso a paso, de la firma
del contrato a la cobranza, con alertas y un mail diario. Es una app separada del
sistema de stock, pero usa la misma base de datos de Supabase (tablas `op_*`) y los
mismos usuarios.

## Partes

| Carpeta | Qué es |
| --- | --- |
| `app/`, `components/`, `lib/` | La app (Next.js). Pantallas: Agenda, Operaciones y el tracking de cada operación |
| `supabase/0001_tracking.sql` | Tablas, permisos, sincronización y reglas de alertas |
| `supabase/0002_lugar_carga.sql` | Dónde se carga y depósito |
| `supabase/0003_mails.sql` a `0006` | Pasos leídos del mail, fecha del booking y pantalla "Del mail" |
| `apps-script/TrackingComex.gs` | Lee las planillas y el mail cada 15 minutos, carga la base y manda el mail diario de las 8 |

## Instalación (una sola vez)

1. **Base de datos.** En Supabase (proyecto `sistema-stock`) > SQL Editor, pegar
   `supabase/0001_tracking.sql`, reemplazar `REEMPLAZAR-POR-UNA-FRASE-LARGA-Y-SECRETA`
   por una frase larga inventada, y ejecutar. Se puede volver a ejecutar sin perder datos.
2. **App.** En Vercel (equipo argreen) > Add New > Project > importar el repositorio
   `valentinahastun/sistema-stock`, rama **`tracking`**. Variables de entorno: las mismas
   `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` del sistema de stock.
   En Settings > Git, poner `tracking` como rama de producción.
3. **Login con Google.** En Supabase > Authentication > URL Configuration, agregar el
   link de la app nueva a "Redirect URLs" (por ejemplo `https://tracking-comex.vercel.app/**`).
4. **Sincronización.** En script.google.com, con la cuenta de Valentina: Nuevo proyecto,
   pegar `apps-script/TrackingComex.gs`. En Configuración del proyecto > Propiedades del script:
   - `SUPABASE_URL`: la URL del proyecto de Supabase
   - `SUPABASE_ANON_KEY`: la clave anon public (nunca la service_role)
   - `TOKEN_SYNC`: la misma frase del paso 1
   - `APP_URL`: el link de la app (para los links del mail diario)

   Zona horaria del proyecto: Buenos Aires. Ejecutar `sincronizar` una vez (pide permisos)
   y después `instalar` (programa la sincronización cada 15 minutos y el mail a las 8).

## Quién entra

La tabla `op_usuarios` define el acceso: `editor` (Lourdes y Valentina) o `lectura`.
Para sumar a alguien en modo lectura, en el SQL Editor:

```sql
insert into op_usuarios (email, rol) values ('nombre@argreen.com.ar', 'lectura');
```

Esa persona necesita además un usuario en Supabase (el mismo del sistema de stock, o
entrar con Google con su cuenta de Argreen).

## Reglas principales

- Operación abierta: CV del año que no figura COBRADO en COBRANZAS, o que está en
  PROYECCION CARGAS. Quedan afuera Iguazú, Brasil, Chile y Uruguay.
- Lo que se marca a mano en la app nunca lo pisa la sincronización.
- Un paso que la planilla muestra hecho pero sin fecha toma la fecha del día en que se detectó.

## Pasos que se leen del mail

Después de cada sincronización el script revisa el Gmail de Valentina:

| Paso | Cómo lo reconoce | |
| --- | --- | --- |
| Drafts enviados | Lourdes o Valentina mandan al cliente o broker un adjunto draft (draft BL, PREFITO, ORIGEN - AG nnn, borrador); el CV sale del asunto | solo |
| Originales emitidos | Lourdes o Valentina mandan un adjunto "scan cv 26-…" | solo |
| Booking (fecha) | El primer mail que nombra el número de booking | solo |
| Draft BL aprobado | En el hilo "DRAFT - AG nnn" con Reymar, Lourdes o Valentina escriben "aprobado" | solo |
| Certificado de origen y fito | Reymar manda los originales en el hilo "DRAFT - AG nnn" | solo |
| BL fechado | Asunto "BL FINAL FECHADO - CV …" | solo |

No se pide confirmar nada: lo que no se puede asignar (sin CV, o un CV con varios
lotes cuando el mail no dice cuál) se guarda sin aparecer. La pantalla "Del mail"
muestra lo que se marcó solo. Lo marcado a mano nunca se pisa. Para revisar de nuevo los últimos
60 días: ejecutar `reiniciarLecturaMails` en el Apps Script.
