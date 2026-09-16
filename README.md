# Sistema de Stock — Fase 1

Aplicación web para consolidar el stock de FRACOGA, LEGUCER, BAYA CASAL, ALIMENTOS
TROPICALES y CARAM en un solo lugar. Esta primera versión cubre: alta de
movimientos (ingreso, descarte, egreso), panel de stock consolidado con
filtro por planta y producto, exportación a Excel, y login con dos roles
(administrador / consulta).

Está construida con Next.js (la aplicación web) y Supabase (base de datos,
login y almacenamiento). No hace falta contratar hosting propio: los dos
tienen plan gratuito que alcanza de sobra para este volumen.

## 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com), creá una cuenta gratis y
   después un proyecto nuevo (elegí una contraseña de base de datos y
   guardala, no hace falta recordarla para el día a día).
2. Una vez creado, andá a **SQL Editor** (menú de la izquierda) y ejecutá,
   en este orden, cada archivo de la carpeta `supabase/migrations` (pegás
   todo el contenido de uno, apretás **Run**, y recién ahí pasás al
   siguiente):
   - `0001_init.sql` (crea todas las tablas, con plantas y productos
     actuales ya cargados)
   - `0002_calidad_storage.sql` (bucket de fotos de calidad)
   - `0003_calidad_standalone.sql` (rol "calidad" y calidad cargada antes
     de que exista el lote)
   - `0004_calidad_fotos_rol.sql` (permiso de fotos para el rol "calidad")
3. Andá a **Project Settings > API** y copiá dos valores: **Project URL** y
   **anon public key**. Los vas a necesitar en el paso 3.

## 2. Dar de alta a los usuarios

1. Andá a **Authentication > Users > Add user** y creá un usuario por cada
   persona (email y contraseña). Por defecto, todos quedan con rol
   "consulta" (solo lectura).
2. Para que tu usuario sea el administrador (el único que puede cargar
   datos), andá a **SQL Editor** y corré, reemplazando el email:

   ```sql
   update public.profiles
   set rol = 'admin'
   where id = (select id from auth.users where email = 'tu-email@ejemplo.com');
   ```

3. Repetí el alta de usuario para los 4 usuarios de consulta. No hace falta
   tocarles el rol: ya quedan como consulta.
4. Para la persona que carga la calidad en el momento de la carga (foto, %
   zaranda, defectos, contrato), dala de alta igual que a los demás y
   después corré, reemplazando el email:

   ```sql
   update public.profiles
   set rol = 'calidad'
   where id = (select id from auth.users where email = 'email-del-compañero@ejemplo.com');
   ```

   Con ese rol puede cargar calidad desde el celular (incluso sin lote
   todavía cargado) pero no ve ni puede tocar el stock.

## 2.1. Habilitar el inicio de sesión con Google (opcional)

El login ya tiene el botón de Google armado, pero para que funcione hay que
activarlo en dos lugares:

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   creá una "OAuth client ID" de tipo "Web application". Como "Authorized
   redirect URI" poné la que te muestra Supabase en el paso 2 (la vas a
   encontrar en **Authentication > Providers > Google**, ya con el formato
   correcto para copiar y pegar).
2. En Supabase, andá a **Authentication > Providers**, buscá **Google**,
   activalo, y pegá ahí el Client ID y el Client Secret que te dio Google en
   el paso anterior.

Si no lo configurás, el botón de Google queda ahí pero no hace nada; el
login con usuario y contraseña funciona igual sin este paso.

## 3. Configurar la aplicación

En esta carpeta, copiá `.env.example` a `.env.local` y completá con los
valores que copiaste en el paso 1:

```
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
```

## 4. Probar en tu computadora (opcional)

Si tenés Node.js instalado:

```
npm install
npm run dev
```

Y abrís `http://localhost:3000`.

## 5. Publicar en Vercel

1. Subí esta carpeta a un repositorio de GitHub (podés arrastrarla directo
   en github.com/new si no usás git seguido).
2. Entrá a [vercel.com](https://vercel.com), creá una cuenta gratis con el
   mismo GitHub, y elegí **Add New > Project**, seleccionando ese
   repositorio.
3. En la pantalla de configuración, antes de deployar, agregá las mismas
   dos variables de entorno del paso 3 (`NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Apretá **Deploy**. En un par de minutos Vercel te da una URL pública
   (algo como `sistema-stock.vercel.app`) para entrar desde cualquier lado.

## Qué falta

Esto es la Fase 1 (núcleo de stock). Quedan pendientes, para las próximas
etapas ya acordadas:

- **Fase 2**: registro de calidad por lote (bajo zaranda, partidos,
  arrugados, otros granos) con fotos, incluyendo carga desde el celular en
  el momento de la carga y sin necesidad de que el lote ya exista en el
  sistema. Listo.
- **Fase 3**: sincronización de contratos desde la solapa VENTAS de
  "Seguimiento COMEX ARGREEN.xlsx", imputación de lotes y saldo pendiente
  por línea de contrato. Las tablas `contratos`, `lineas_contrato` e
  `imputaciones` ya están creadas, falta la integración y las pantallas.

Cualquier cambio de acá en más lo vamos haciendo sobre este mismo proyecto.
