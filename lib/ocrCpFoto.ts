"use client";

// Lee una foto de Carta de Porte en el mismo celular/compu, gratis: el OCR
// (tesseract.js) corre en el navegador y baja su motor y el idioma español
// de un CDN público la primera vez (unos 6 MB; después queda guardado).
// Nada de la foto sale del dispositivo.

import { combinarLecturas, renglonesEnderezados, type CpFoto, type LineaOcr } from "./parseCpFoto";

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let workerListo: Promise<Worker> | null = null;
let avisar: ((texto: string) => void) | null = null;

function obtenerWorker(): Promise<Worker> {
  if (!workerListo) {
    workerListo = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("spa", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (!avisar) return;
          if (/loading|initializ/i.test(m.status)) avisar("Preparando el lector (la primera vez tarda un poco más)…");
          else if (/recognizing/i.test(m.status)) avisar(`Leyendo la foto… ${Math.round(m.progress * 100)}%`);
        },
      });
    })().catch((e) => {
      workerListo = null;
      throw e;
    });
  }
  return workerListo;
}

// La foto del celular suele ser enorme (4000 px): se achica a un tamaño en
// el que el texto de la CP se lee bien y el OCR no tarda una eternidad.
async function prepararImagen(archivo: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const MAX = 2200;
  const escala = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

const completa = (d: CpFoto) =>
  !!d.numeroCpe &&
  !!d.pesoNetoCargaKg &&
  !!d.observaciones &&
  !!d.titular &&
  !!d.chofer &&
  !!(d.fechaPartida || d.fecha) &&
  !!d.patente &&
  d.dudas.length === 0;

export async function leerFotoCp(archivo: File, onProgreso?: (texto: string) => void): Promise<CpFoto> {
  avisar = onProgreso ?? null;
  try {
    onProgreso?.("Preparando la foto…");
    const [imagen, worker] = await Promise.all([prepararImagen(archivo), obtenerWorker()]);

    // 1) lectura por renglones (rápida y buena si la foto está derecha)
    await worker.setParameters({ tessedit_pageseg_mode: "6" as never, preserve_interword_spaces: "1" });
    const primera = await worker.recognize(imagen);
    const texto6 = primera.data.text;
    const sola = combinarLecturas([texto6]);
    if (completa(sola)) return sola;

    // 2) lectura palabra por palabra, enderezando los renglones (para fotos
    //    sacadas un poco de costado): completa lo que faltó en la primera
    onProgreso?.("Segunda pasada para completar datos…");
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
    const segunda = await worker.recognize(imagen, {}, { blocks: true, text: false });
    const lineas: LineaOcr[] = [];
    for (const b of segunda.data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          lineas.push({ baseline: l.baseline, palabras: l.words.map((w) => ({ t: w.text, ...w.bbox })) });
    return combinarLecturas([texto6, renglonesEnderezados(lineas)]);
  } finally {
    avisar = null;
  }
}
