import Link from "next/link";

// Filtro "Todas / Lourdes / Valentina" que se mantiene en la URL (?resp=).
export default function FiltroResponsable({
  base,
  actual,
  extra = {},
}: {
  base: string;
  actual: string;
  extra?: Record<string, string>;
}) {
  const opciones = [
    { v: "todas", t: "Todas" },
    { v: "lourdes", t: "Lourdes" },
    { v: "valentina", t: "Valentina" },
  ];
  return (
    <div className="inline-flex rounded border border-gray-300 bg-white overflow-hidden text-sm">
      {opciones.map((o) => {
        const q = new URLSearchParams({ ...extra, resp: o.v }).toString();
        return (
          <Link
            key={o.v}
            href={`${base}?${q}`}
            className={
              "px-3 py-1.5 border-l first:border-l-0 " +
              (actual === o.v ? "bg-brand-navy text-white" : "text-gray-700 hover:bg-gray-50")
            }
          >
            {o.t}
          </Link>
        );
      })}
    </div>
  );
}
