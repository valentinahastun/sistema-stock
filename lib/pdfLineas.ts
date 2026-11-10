import { reconstruirLineas } from "@/lib/parseCp";

// Texto de un PDF, renglón por renglón (todas las páginas). Solo servidor.
// Mismo armado que la lectura de la CP: pdfjs con DOMMatrix y worker
// cargados a mano para que funcione en Vercel.
export async function lineasDePdf(buffer: Uint8Array): Promise<string[]> {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
    const { default: DOMMatrixPolyfill } = await import("dommatrix");
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }
  if (typeof (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker === "undefined") {
    const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
  }
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: buffer, useSystemFonts: true, isEvalSupported: false }).promise;
  const lineas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it): it is typeof it & { str: string; transform: number[] } => "str" in it)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    lineas.push(...reconstruirLineas(items));
  }
  await doc.destroy();
  return lineas;
}
