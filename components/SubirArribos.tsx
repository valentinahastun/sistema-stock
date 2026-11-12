"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmarArribos, type CpConfirmada, type ResultadoArribo } from "@/app/arribos/actions";

// Subir una o varias CPE confirmadas (PDF bajado de ARCA): se leen y se
// confirma el arribo de cada camión con lo descargado.
export default function SubirArribos() {
  const router = useRouter();
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [resultados, setResultados] = useState<ResultadoArribo[]>([]);

  async function subir(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true);
    setResultados([]);
    const cps: CpConfirmada[] = [];
    const errores: ResultadoArribo[] = [];
    const lista = Array.from(files);
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      setProgreso(`Leyendo ${i + 1} de ${lista.length}…`);
      try {
        const fd = new FormData();
        fd.append("archivo", f);
        const r = await fetch("/api/cp/parse", { method: "POST", body: fd });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se pudo leer");
        cps.push({
          archivo: f.name,
          numeroCpe: j.datos.numeroCpe,
          cargadoKg: j.datos.pesoNetoCargaKg,
          descargadoKg: j.datos.pesoNetoDescargaKg,
          fechaDescarga: j.datos.fechaDescarga,
        });
      } catch (e) {
        errores.push({ archivo: f.name, cp: null, estado: "error", texto: (e as Error).message });
      }
    }
    setProgreso("Guardando…");
    const res = cps.length ? await confirmarArribos(cps) : [];
    setResultados([...res, ...errores]);
    setLeyendo(false);
    setProgreso("");
    router.refresh();
  }

  const color: Record<ResultadoArribo["estado"], string> = {
    ok: "text-green-700",
    diferencia: "text-red-600",
    sin_descarga: "text-amber-700",
    no_encontrada: "text-amber-700",
    error: "text-red-600",
  };
  const icono: Record<ResultadoArribo["estado"], string> = {
    ok: "✓",
    diferencia: "⚠",
    sin_descarga: "…",
    no_encontrada: "?",
    error: "✗",
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium cursor-pointer ${
            leyendo ? "bg-gray-200 text-gray-500" : "bg-brand-green text-white hover:opacity-90"
          }`}
        >
          📄 Subir CPE confirmadas
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={leyendo}
            className="hidden"
            onChange={(e) => {
              subir(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <span className="text-xs text-gray-500">
          {leyendo ? progreso : "Los PDF que bajás de ARCA. Podés subir varios juntos."}
        </span>
      </div>
      {resultados.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {resultados.map((r, i) => (
            <li key={i} className={color[r.estado]}>
              {icono[r.estado]} <span className="font-medium">{r.cp ?? r.archivo}</span>: {r.texto}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
