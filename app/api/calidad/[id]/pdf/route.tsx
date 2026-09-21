import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Link,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";

// Genera, al vuelo (no se guarda en ningún lado), el PDF de un registro de
// calidad puntual: mismos parámetros bilingües que se ven en /calidad, más
// las fotos embebidas y un link para cada video (un PDF no puede reproducir
// video, así que eso es lo máximo que se puede hacer).

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

function esVideo(url: string): boolean {
  return /\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i.test(url);
}

function esPng(buf: Buffer): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

function esJpg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

// El PDF solo sabe dibujar JPG/PNG. Si la foto es de otro formato (webp,
// heic de algunos celulares, etc.) o no se pudo bajar, devuelve null y el
// PDF muestra un link a la foto en vez de la imagen embebida.
async function bajarImagenParaPdf(
  url: string
): Promise<{ data: Buffer; format: "png" | "jpg" } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());

    if (contentType.includes("png") || esPng(buf)) return { data: buf, format: "png" };
    if (contentType.includes("jpeg") || contentType.includes("jpg") || esJpg(buf)) {
      return { data: buf, format: "jpg" };
    }
    return null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#1e293b", fontFamily: "Helvetica" },
  logo: { width: 130, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, color: "#1e3a5f", marginBottom: 12 },
  infoRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14 },
  infoItem: { width: "50%", marginBottom: 4 },
  infoLabel: { fontWeight: 700 },
  sectionHeader: {
    backgroundColor: "#eef2f9",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginTop: 10,
    marginBottom: 10,
  },
  sectionHeaderText: { fontWeight: 700, fontSize: 11, color: "#1e3a5f" },
  campoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  campoRowDestacado: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    marginTop: 4,
    marginBottom: 4,
  },
  campoLabel: {},
  campoLabelDestacado: { fontWeight: 700 },
  campoValor: { fontWeight: 700 },
  observaciones: { lineHeight: 1.5 },
  multimediaLabel: { fontWeight: 700, marginTop: 12, marginBottom: 8, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  foto: {
    width: 150,
    height: 150,
    objectFit: "cover",
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 8,
  },
  link: { color: "#2563eb", marginBottom: 6, fontSize: 10 },
  sinDatos: { color: "#94a3b8" },
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const perfil = await getPerfilActual();
  if (!perfil) {
    return new Response("No autorizado.", { status: 401 });
  }

  const supabase = createClient();

  const { data: registro, error } = await supabase
    .from("registros_calidad")
    .select(
      "id, fecha, pct_partidos, pct_tegumento_danado, pct_levemente_manchados, pct_manchados, pct_arrugados, pct_otros_defectos_graves, pct_otros_defectos_leves, pct_danos_totales, pct_materia_extrana, pct_humedad, pct_bajo_zaranda, observaciones, fotos, lote_id, numero_contrato, planta_id, producto_id, productor_id, lotes(numero_cp, planta_id, producto_id, productor_id, plantas(nombre), productos(nombre), productores(nombre)), plantas(nombre), productos(nombre), productores(nombre)"
    )
    .eq("id", params.id)
    .single();

  if (error || !registro) {
    return new Response("No se encontró el registro de calidad.", { status: 404 });
  }

  const lotes: any = registro.lotes;
  const lote = Array.isArray(lotes) ? lotes[0] : lotes;

  const datos = lote
    ? {
        planta: nombreDe(lote.plantas),
        producto: nombreDe(lote.productos),
        productor: nombreDe(lote.productores),
        cp: lote.numero_cp ?? "—",
      }
    : {
        planta: nombreDe(registro.plantas as Rel) || "—",
        producto: nombreDe(registro.productos as Rel) || "—",
        productor: nombreDe(registro.productores as Rel) || "—",
        cp: registro.numero_contrato ? `contrato ${registro.numero_contrato}` : "sin vincular",
      };

  const pct = (n: number | null) => (n === null ? "—" : `${Number(n).toFixed(2)}%`);

  const fotosYVideos: string[] = registro.fotos ?? [];
  const imagenes = fotosYVideos.filter((f) => !esVideo(f));
  const videos = fotosYVideos.filter(esVideo);

  const imagenesEmbebidas = await Promise.all(
    imagenes.map(async (url) => ({ url, img: await bajarImagenParaPdf(url) }))
  );

  const logoPath = path.join(process.cwd(), "public", "logo.png");
  const logoBuffer = await readFile(logoPath).catch(() => null);

  const campos: { label: string; valor: number | null }[] = [
    { label: "Partidos y quebrados / Split and broken", valor: registro.pct_partidos },
    { label: "Tegumento dañado / Skin damage", valor: registro.pct_tegumento_danado },
    { label: "Levemente manchados / Slightly stained grains", valor: registro.pct_levemente_manchados },
    { label: "Manchados / Stained grains", valor: registro.pct_manchados },
    { label: "Arrugados / Wrinkled grains", valor: registro.pct_arrugados },
    { label: "Otros defectos graves / Other severe defects", valor: registro.pct_otros_defectos_graves },
    { label: "Otros defectos leves / Other minor defects", valor: registro.pct_otros_defectos_leves },
  ];

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        {logoBuffer && <Image src={{ data: logoBuffer, format: "png" }} style={styles.logo} />}
        <Text style={styles.title}>Ficha de calidad / Quality report</Text>

        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text><Text style={styles.infoLabel}>Fecha / Date: </Text>{registro.fecha}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text><Text style={styles.infoLabel}>CP / Contrato: </Text>{datos.cp}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text><Text style={styles.infoLabel}>Planta / Plant: </Text>{datos.planta}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text><Text style={styles.infoLabel}>Producto / Product: </Text>{datos.producto}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text><Text style={styles.infoLabel}>Productor / Producer: </Text>{datos.productor}</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>Especificaciones / Specifications</Text>
        </View>

        <View style={styles.campoRow}>
          <Text style={styles.campoLabel}>Humedad / Moisture</Text>
          <Text style={styles.campoValor}>{pct(registro.pct_humedad)}</Text>
        </View>
        <View style={styles.campoRow}>
          <Text style={styles.campoLabel}>Materia extraña / Foreign matter</Text>
          <Text style={styles.campoValor}>{pct(registro.pct_materia_extrana)}</Text>
        </View>

        {campos.map((c) => (
          <View style={styles.campoRow} key={c.label}>
            <Text style={styles.campoLabel}>{c.label}</Text>
            <Text style={styles.campoValor}>{pct(c.valor)}</Text>
          </View>
        ))}

        <View style={styles.campoRowDestacado}>
          <Text style={styles.campoLabelDestacado}>DAÑOS TOTALES / TOTAL DAMAGES</Text>
          <Text style={styles.campoLabelDestacado}>{pct(registro.pct_danos_totales)}</Text>
        </View>

        <View style={styles.campoRow}>
          <Text style={styles.campoLabel}>Bajo zaranda / Undersize</Text>
          <Text style={styles.campoValor}>{pct(registro.pct_bajo_zaranda)}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>Observaciones / Observations</Text>
        </View>
        <Text style={registro.observaciones ? styles.observaciones : styles.sinDatos}>
          {registro.observaciones ?? "—"}
        </Text>
      </Page>

      {(imagenes.length > 0 || videos.length > 0) && (
        <Page size="A4" style={styles.page}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>Multimedia</Text>
          </View>

          <Text style={styles.multimediaLabel}>Imágenes:</Text>
          {imagenes.length === 0 ? (
            <Text style={styles.sinDatos}>—</Text>
          ) : (
            <View style={styles.grid}>
              {imagenesEmbebidas.map(({ url, img }, i) =>
                img ? (
                  <Image key={url} src={{ data: img.data, format: img.format }} style={styles.foto} />
                ) : (
                  <Link key={url} src={url} style={styles.link}>
                    Ver imagen {i + 1} (no se pudo incrustar, abrir en el navegador)
                  </Link>
                )
              )}
            </View>
          )}

          <Text style={styles.multimediaLabel}>Video:</Text>
          {videos.length === 0 ? (
            <Text style={styles.sinDatos}>—</Text>
          ) : (
            videos.map((url, i) => (
              <Link key={url} src={url} style={styles.link}>
                Ver video {i + 1}
              </Link>
            ))
          )}
        </Page>
      )}
    </Document>
  );

  const buffer = await renderToBuffer(doc);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="calidad_${datos.producto.replace(/\s+/g, "_")}_${registro.fecha}.pdf"`,
    },
  });
}
