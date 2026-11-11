// Lee la cantidad de bolsas que se escribe a mano en "Observaciones" de la
// CP: "1162 bolsas x 25 kg", "1.162 BLS DE 25", "580 bls 50kg", "20 big bags",
// "20 BB". Si no está la palabra bolsa/bls/big bag no adivina.

export type Bolsas = { bolsas_25: number | null; bolsas_50: number | null; big_bags: number | null };

export type LecturaBolsas = Bolsas & {
  leido: boolean;
  aviso: string | null; // si bolsas x kg no da con el peso neto
  detalle: string | null; // "1162 × 25 kg = 29.050 kg (peso neto 29.000 kg)"
};

const aEntero = (s: string) => Number(s.replace(/[.,\s]/g, ""));

export function leerBolsas(texto: string | null | undefined, pesoNetoKg: number | null = null): LecturaBolsas {
  const vacio: LecturaBolsas = { bolsas_25: null, bolsas_50: null, big_bags: null, leido: false, aviso: null, detalle: null };
  if (!texto) return vacio;
  const t = texto.replace(/\s+/g, " ");
  let b25 = 0;
  let b50 = 0;
  let bb = 0;
  let sinTamano = 0;

  // Big bags / bolsones primero (para que "bags" no se cuente como bolsa)
  const reBb = /(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:big\s*-?\s*bags?|bigbags?|b\.?\s?b\.?(?=\W|$)|bols[oó]n(?:es)?)/gi;
  let resto = t.replace(reBb, (_m, n) => {
    bb += aEntero(n);
    return " ";
  });

  // Bolsas, con tamaño opcional: "x 25 kg", "de 50", "25kg", "(25 kg)"
  const reBolsa = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:bolsas?|bls?\.?|bol\.?)(?:\s*(?:x|de|por|\()?\s*(25|50)\s*(?:kgs?|k)?\b)?/gi;
  resto.replace(reBolsa, (_m, n, kg) => {
    const cant = aEntero(n);
    if (kg === "25") b25 += cant;
    else if (kg === "50") b50 += cant;
    else sinTamano += cant;
    return " ";
  });

  // Sin tamaño: se deduce del peso neto (25 o 50 kg por bolsa)
  if (sinTamano > 0) {
    if (pesoNetoKg && Math.abs(pesoNetoKg / sinTamano - 50) < Math.abs(pesoNetoKg / sinTamano - 25)) b50 += sinTamano;
    else b25 += sinTamano;
  }

  if (!b25 && !b50 && !bb) return vacio;
  const r: LecturaBolsas = {
    bolsas_25: b25 || null,
    bolsas_50: b50 || null,
    big_bags: bb || null,
    leido: true,
    aviso: null,
    detalle: null,
  };

  // Control: bolsas x kg contra el peso neto (solo si no hay big bags, que no tienen peso fijo)
  if (pesoNetoKg && !bb) {
    const kg = b25 * 25 + b50 * 50;
    const dif = kg - pesoNetoKg;
    const partes = [b25 ? `${b25.toLocaleString("es-AR")} × 25 kg` : null, b50 ? `${b50.toLocaleString("es-AR")} × 50 kg` : null].filter(Boolean).join(" + ");
    r.detalle = `${partes} = ${kg.toLocaleString("es-AR")} kg (peso neto ${pesoNetoKg.toLocaleString("es-AR")} kg)`;
    if (Math.abs(dif) > Math.max(100, pesoNetoKg * 0.01)) {
      r.aviso = `Las bolsas no dan con el peso: ${r.detalle}. Revisá la cantidad de bolsas.`;
    }
  }
  return r;
}
