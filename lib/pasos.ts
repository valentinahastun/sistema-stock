// Los pasos de una operación, en orden. Las reglas de "aplica" tienen que
// coincidir con las de las alertas en supabase/0001_tracking.sql.

export type Operacion = {
  clave: string;
  cv: string;
  lote: string | null;
  cliente: string | null;
  broker: string | null;
  silver: boolean;
  destino: string | null;
  producto: string | null;
  tn: number | null;
  responsable: "lourdes" | "valentina" | null;
  payment_terms: string | null;
  fecha_contrato: string | null;
  tipo_bl: string | null;
  booking: string | null;
  contenedores: string | null;
  fecha_carga_planta: string | null;
  fecha_consolidado: string | null;
  corte_documental: string | null;
  lugar_carga: string | null;
  deposito: string | null;
  etd: string | null;
  eta: string | null;
  activa: boolean;
};

export type Hito = {
  clave: string;
  paso: string;
  fecha: string | null;
  fuente: string;
  detalle: string | null;
  mail_url: string | null;
  updated_by: string | null;
};

export type Alerta = {
  clave: string;
  cv: string;
  lote: string | null;
  cliente: string | null;
  destino: string | null;
  responsable: string | null;
  paso: string;
  nivel: "vencida" | "proxima";
  mensaje: string;
  fecha_limite: string | null;
  en_mail: boolean;
};

export type Paso = { codigo: string; nombre: string; ayuda?: string };

export const conAnticipo = (o: Operacion) =>
  /(anticip|advance|adelant|previo)/i.test(o.payment_terms ?? "");

export const pideIp = (o: Operacion) =>
  /(pakist|karachi|filipin|manila|venezuel|cabello|colombia|buenaventura|cartagena)/i.test(o.destino ?? "");

export const esCopyDocs = (o: Operacion) => /cop/i.test(o.payment_terms ?? "");

// Documentos que hay que juntar antes de mandar a emitir originales.
export function documentos(o: Operacion): Paso[] {
  const lista: Paso[] = [
    { codigo: "doc_peso", nombre: "Certificado de peso (ISB)" },
    { codigo: "doc_calidad", nombre: "Certificado de calidad (ISB)" },
    { codigo: "doc_fumigacion", nombre: "Certificado de fumigación (ISB)" },
    { codigo: "doc_co", nombre: "Certificado de origen (Reymar)" },
    { codigo: "doc_fito", nombre: "Fitosanitario (Reymar)" },
    { codigo: "doc_bl", nombre: "BL fechado (forwarder)" },
    { codigo: "doc_pl", nombre: "Packing list" },
    { codigo: "doc_factura", nombre: "Factura Argreen" },
  ];
  if (o.silver) lista.push({ codigo: "doc_factura_silver", nombre: "Factura Silver" });
  return lista;
}

export function pasos(o: Operacion): Paso[] {
  const lista: Paso[] = [
    { codigo: "firma", nombre: "Contrato firmado" },
    { codigo: "etiqueta", nombre: "Etiqueta aprobada", ayuda: "Al menos 2 días antes de la carga en planta" },
  ];
  if (conAnticipo(o)) lista.push({ codigo: "anticipo", nombre: "Anticipo cobrado" });
  if (pideIp(o)) lista.push({ codigo: "ip", nombre: "IP emitido" });
  lista.push(
    { codigo: "booking", nombre: "Booking confirmado" },
    { codigo: "camiones", nombre: "Camiones cargados" },
    { codigo: "retiro", nombre: "Contenedores retirados" },
    { codigo: "consolidado", nombre: "Consolidado" },
    { codigo: "ddee", nombre: "DDEE aprobada" },
    { codigo: "draft_enviado", nombre: "Draft BL enviado al cliente" },
    { codigo: "draft_aprobado", nombre: "Draft BL aprobado", ayuda: "Alerta a los 2 días sin respuesta" },
    { codigo: "documentos", nombre: "Documentos completos", ayuda: "Se guardan en docus expo" },
    { codigo: "originales", nombre: "Originales emitidos", ayuda: "Se guardan en docus definitivos" },
    { codigo: "flete", nombre: "Pago de flete y liberación del BL" },
  );
  const envio = { codigo: "envio_docs", nombre: "Envío de documentos" };
  const cobro = { codigo: "cobranza", nombre: "Cobranza" };
  // CAD: se mandan los documentos y después se cobra. Copy docs: al revés.
  if (esCopyDocs(o)) lista.push(cobro, envio);
  else lista.push(envio, cobro);
  return lista;
}

// "Documentos completos" está hecho si se marcó a mano o si están todos los de la lista.
export function documentosCompletos(o: Operacion, hechos: Map<string, Hito>): boolean {
  return hechos.has("documentos") || documentos(o).every((d) => hechos.has(d.codigo));
}

export function estaHecho(o: Operacion, codigo: string, hechos: Map<string, Hito>) {
  return codigo === "documentos" ? documentosCompletos(o, hechos) : hechos.has(codigo);
}

// El paso en el que está la operación: el primero sin hacer después del último hecho.
export function pasoActual(o: Operacion, hechos: Map<string, Hito>): Paso | null {
  const lista = pasos(o);
  let ultimo = -1;
  lista.forEach((p, i) => {
    if (estaHecho(o, p.codigo, hechos)) ultimo = i;
  });
  return lista.slice(ultimo + 1).find((p) => !estaHecho(o, p.codigo, hechos)) ?? null;
}

export const NOMBRE_RESPONSABLE: Record<string, string> = {
  lourdes: "Lourdes",
  valentina: "Valentina",
};

export const NOMBRE_FUENTE: Record<string, string> = {
  manual: "a mano",
  mail: "mail",
  ventas: "VENTAS",
  seguimiento: "Seguimiento",
  proyeccion: "PROYECCION CARGAS",
  pagos_fletes: "PAGOS FLETES",
  cobranzas: "COBRANZAS",
};

export function fecha(d: string | null | undefined, conAnio = false): string {
  if (!d) return "—";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return conAnio ? `${dd}/${m}/${y}` : `${dd}/${m}`;
}

export function nombreOperacion(o: { cv: string; lote: string | null }) {
  return `CV ${o.cv}${o.lote ? " " + o.lote : ""}`;
}
