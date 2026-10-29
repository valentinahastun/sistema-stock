"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completarCoccion } from "@/app/calidad/actions";
import CoccionCampos, { type ValoresCoccion } from "@/components/CoccionCampos";

// Botón de la lista de Calidad para completar (o corregir) contrato,
// cocción, hidratación y apto de un análisis que ya está cargado.
export default function CompletarCoccion({
  registroId,
  iniciales,
  contratoInicial,
  titulo,
}: {
  registroId: string;
  iniciales: ValoresCoccion;
  contratoInicial: string;
  titulo: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<ValoresCoccion>(iniciales);
  const [contrato, setContrato] = useState(contratoInicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const completo = iniciales.apto !== "";

  async function guardar(formData: FormData) {
    setGuardando(true);
    setError(null);
    const r = await completarCoccion(registroId, formData);
    setGuardando(false);
    if (r.ok) {
      setAbierto(false);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValores(iniciales);
          setContrato(contratoInicial);
          setError(null);
          setAbierto(true);
        }}
        className={
          "text-xs rounded px-2 py-1 whitespace-nowrap border " +
          (completo
            ? "border-gray-300 text-gray-600 hover:bg-gray-50"
            : "border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100")
        }
      >
        {completo ? "Editar análisis" : "Completar análisis"}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !guardando && setAbierto(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-medium text-brand-navy mb-1">Completar análisis</h3>
            <p className="text-xs text-gray-500 mb-4">{titulo}</p>
            <form action={guardar} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Contrato (CV)
                </label>
                <input
                  name="numero_contrato"
                  type="text"
                  className="input"
                  placeholder="Ej.: 26-118"
                  value={contrato}
                  onChange={(e) => setContrato(e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Dejalo vacío si todavía no sabés a qué contrato va.
                </p>
              </div>
              <CoccionCampos
                valores={valores}
                mostrarAviso={false}
                onCambio={(campo, valor) => setValores((v) => ({ ...v, [campo]: valor }))}
              />
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  disabled={guardando}
                  className="border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="bg-brand-green hover:bg-brand-green-dark text-white rounded px-4 py-2 text-sm disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
          <style jsx global>{`
            .input {
              width: 100%;
              border: 1px solid #d1d5db;
              border-radius: 0.375rem;
              padding: 0.5rem 0.75rem;
              font-size: 0.875rem;
            }
          `}</style>
        </div>
      )}
    </>
  );
}
