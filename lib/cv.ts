// "26-130", "130" o "cv 26-130 a" -> "CV 26-130 A" (igual que al guardar)
export function normalizarCv(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim().toUpperCase();
  if (!t) return null;
  return t
    .split(/\s*[,/]\s*/)
    .map((p) => {
      const m = p.replace(/^CV\s*/, "").match(/^(?:(\d{2})\s*-\s*)?0*(\d{1,3})\s*([A-Z])?$/);
      if (!m) return p;
      return `CV ${m[1] ?? "26"}-${m[2].padStart(3, "0")}${m[3] ? " " + m[3] : ""}`;
    })
    .join(", ");
}
