"use client";

// Bloque de cocción, hidratación y decisión de apto. Se usa en la carga
// de un análisis nuevo (CalidadForm) y al completarlo después desde la
// lista (CompletarCoccion), porque la hidratación lleva horas de remojo.

export type ValoresCoccion = {
  coccion_minutos: string;
  coccion_resultado: string; // "" | "bien" | "mal"
  hidratacion_peso_seco: string;
  hidratacion_peso_hidratado: string;
  apto: string; // "" (pendiente) | "si" | "no"
};

export const coccionVacia: ValoresCoccion = {
  coccion_minutos: "",
  coccion_resultado: "",
  hidratacion_peso_seco: "",
  hidratacion_peso_hidratado: "",
  apto: "",
};

// Mismo cálculo que la columna hidratacion_pct de la base.
export function calcularHidratacion(seco: string, hidratado: string): number | null {
  const s = Number(seco);
  const h = Number(hidratado);
  if (seco === "" || hidratado === "" || Number.isNaN(s) || Number.isNaN(h) || s <= 0) return null;
  return ((h - s) / s) * 100;
}

export default function CoccionCampos({
  valores,
  onCambio,
  mostrarAviso = true,
}: {
  valores: ValoresCoccion;
  onCambio: (campo: keyof ValoresCoccion, valor: string) => void;
  mostrarAviso?: boolean;
}) {
  const hidratacion = calcularHidratacion(
    valores.hidratacion_peso_seco,
    valores.hidratacion_peso_hidratado
  );

  return (
    <fieldset className="border border-brand-green/40 rounded p-3 space-y-4">
      <legend className="px-1 text-sm font-medium text-brand-navy">
        Cocción e hidratación
      </legend>

      <div className="grid grid-cols-2 gap-4">
        <Campo label="Tiempo de cocción (minutos)">
          <input
            name="coccion_minutos"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            className="input"
            value={valores.coccion_minutos}
            onChange={(e) => onCambio("coccion_minutos", e.target.value)}
          />
        </Campo>
        <Campo label="¿Cómo cocinó?">
          <select
            name="coccion_resultado"
            className="input"
            value={valores.coccion_resultado}
            onChange={(e) => onCambio("coccion_resultado", e.target.value)}
          >
            <option value="">Todavía no se probó</option>
            <option value="bien">Bien</option>
            <option value="mal">Mal</option>
          </select>
        </Campo>
        <Campo label="Peso seco (g)">
          <input
            name="hidratacion_peso_seco"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="input"
            value={valores.hidratacion_peso_seco}
            onChange={(e) => onCambio("hidratacion_peso_seco", e.target.value)}
          />
        </Campo>
        <Campo label="Peso hidratado (g)">
          <input
            name="hidratacion_peso_hidratado"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="input"
            value={valores.hidratacion_peso_hidratado}
            onChange={(e) => onCambio("hidratacion_peso_hidratado", e.target.value)}
          />
        </Campo>
        <Campo label="Hidratación (% de agua absorbida)">
          <input
            type="text"
            disabled
            className="input bg-gray-100 text-gray-600 font-medium"
            value={hidratacion === null ? "—" : `${hidratacion.toFixed(2)}%`}
          />
        </Campo>
        <Campo label="¿El lote es apto?">
          <select
            name="apto"
            className={
              "input font-medium " +
              (valores.apto === "si"
                ? "text-green-700"
                : valores.apto === "no"
                ? "text-red-700"
                : "text-amber-700")
            }
            value={valores.apto}
            onChange={(e) => onCambio("apto", e.target.value)}
          >
            <option value="">Pendiente</option>
            <option value="si">Apto</option>
            <option value="no">No apto</option>
          </select>
        </Campo>
      </div>
      {mostrarAviso && (
      <p className="text-xs text-gray-400">
        Si la hidratación todavía está en remojo, guardá el análisis igual y
        completala después desde la lista de Calidad.
      </p>
      )}
    </fieldset>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
