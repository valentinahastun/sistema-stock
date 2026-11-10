// Formatos compartidos entre la pantalla de Procesos (servidor) y sus componentes.
export const tn = (n: number | null | undefined, dec = 2) =>
  n === null || n === undefined ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });

export const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

export function hoyIso() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
