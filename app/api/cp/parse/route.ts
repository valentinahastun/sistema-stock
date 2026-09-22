import { NextRequest } from "next/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { parseCp, reconstruirLineas } from "@/lib/parseCp";

// Lee un PDF de Carta de Porte Electrónica (ARCA) subido desde el
// formulario de movimientos y devuelve los datos "neutros" que se pueden
// autocompletar (transportista, chofer, patente, pesos, fechas). Nunca
// intenta determinar planta, producto ni si es ingreso o egreso: eso lo
// sigue eligiendo la persona que carga el movimiento.

export async function POST(request: NextRequest): Promise<Response> {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  let archivo: File | null = null;
  try {
    const formData = await request.formData();
    const f = formData.get("archivo");
    if (f instanceof File) archivo = f;
  } catch (e) {
    return Response.json(
      { ok: false, error: `No se pudo leer el archivo enviado: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  if (!archivo) {
    return Response.json({ ok: false, error: "Falta el archivo PDF." }, { status: 400 });
  }
  if (archivo.type && archivo.type !== "application/pdf") {
    return Response.json({ ok: false, error: "El archivo tiene que ser un PDF." }, { status: 400 });
  }

  try {
    const buffer = new Uint8Array(await archivo.arrayBuffer());

    // pdfjs-dist usa DOMMatrix (una API de navegador) para algunas
    // transformaciones internas, incluso al extraer solo texto. En el
    // entorno serverless de Vercel (Node, sin navegador) no existe, así
    // que se completa con una implementación mínima antes de cargar pdfjs.
    if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
      const { default: DOMMatrixPolyfill } = await import("dommatrix");
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
    }

    // pdfjs-dist normalmente arranca un Worker de navegador para procesar
    // el PDF en otro hilo. En Node (Vercel) eso no existe, así que pdfjs
    // cae a un "fake worker": intenta importar su propio archivo
    // pdf.worker.mjs con una ruta relativa calculada en tiempo de
    // ejecución. Ese import relativo no sobrevive al empaquetado de
    // Next.js/Vercel (el archivo físico no queda en la ruta esperada
    // dentro del bundle serverless), y falla con "Cannot find module
    // .../pdf.worker.mjs". Para evitarlo, importamos nosotros mismos el
    // módulo del worker (con una ruta fija que sí puede empaquetar
    // Next.js) y lo dejamos en globalThis.pdfjsWorker: pdfjs revisa ese
    // global primero y, si está, nunca intenta el import relativo roto.
    if (typeof (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker === "undefined") {
      const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
    }

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({
      data: buffer,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;

    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it): it is typeof it & { str: string; transform: number[] } => "str" in it)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));

    const lineas = reconstruirLineas(items);
    const datos = parseCp(lineas);

    await doc.destroy();

    return Response.json({ ok: true, datos });
  } catch (e) {
    return Response.json(
      { ok: false, error: `No se pudo leer el PDF: ${(e as Error).message}` },
      { status: 422 }
    );
  }
}
