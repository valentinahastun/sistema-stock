import { NextRequest } from "next/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { lineasDePdf } from "@/lib/pdfLineas";
import { leerParte } from "@/lib/parteProceso";

// Lee el parte de proceso que manda la planta (PDF) y devuelve los datos
// para completar el formulario de Nuevo proceso. No guarda nada.
export async function POST(request: NextRequest): Promise<Response> {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }
  let archivo: File | null = null;
  try {
    const f = (await request.formData()).get("archivo");
    if (f instanceof File) archivo = f;
  } catch {
    return Response.json({ ok: false, error: "No se pudo leer el archivo." }, { status: 400 });
  }
  if (!archivo) return Response.json({ ok: false, error: "Falta el archivo." }, { status: 400 });
  if (archivo.type && archivo.type !== "application/pdf") {
    return Response.json(
      { ok: false, error: "Por ahora solo leo PDF. Si es una foto, mandámela por el chat y lo cargo yo." },
      { status: 400 }
    );
  }
  try {
    const lineas = await lineasDePdf(new Uint8Array(await archivo.arrayBuffer()));
    const parte = leerParte(lineas);
    if (!parte) {
      return Response.json(
        { ok: false, error: "No reconozco este formato de parte. Por ahora leo el de Alimentos Tropicales (Planta La Loma)." },
        { status: 422 }
      );
    }
    return Response.json({ ok: true, parte });
  } catch (e) {
    return Response.json({ ok: false, error: `No se pudo leer el PDF: ${(e as Error).message}` }, { status: 422 });
  }
}
