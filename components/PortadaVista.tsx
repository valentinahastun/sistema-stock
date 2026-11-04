import Link from "next/link";

export type Modulo = {
  titulo: string;
  href: string;
  icono: React.ReactNode;
  color: string;
  numeros: { valor: string; texto: string; clase?: string }[];
  links: { href: string; texto: string }[];
};

export default function PortadaVista({ nombre, email, fechaLarga, modulos }: {
  nombre: string; email: string; fechaLarga: string; modulos: Modulo[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Hola, {nombre} 👋</h1>
        <p className="text-sm text-gray-500 first-letter:uppercase">{fechaLarga}</p>
      </div>

      {modulos.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-600">
          Entraste como <b>{email}</b>, pero todavía no tenés acceso a ningún módulo. Pedíselo a Valentina.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modulos.map((m) => (
            <div key={m.titulo} className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 p-5 flex flex-col">
              <Link href={m.href} className="group flex items-center gap-3">
                <span className={`rounded-xl p-3 ${m.color}`}>{m.icono}</span>
                <span className="text-lg font-semibold text-brand-navy group-hover:text-brand-green">{m.titulo}</span>
              </Link>
              <div className="flex gap-6 mt-5">
                {m.numeros.map((n) => (
                  <div key={n.texto}>
                    <div className={"text-2xl font-semibold " + (n.clase ?? "text-brand-navy")}>{n.valor}</div>
                    <div className="text-xs text-gray-500">{n.texto}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-100">
                {m.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-sm rounded-lg px-3 py-1.5 bg-slate-50 text-slate-700 hover:bg-brand-green-light hover:text-brand-navy"
                  >
                    {l.texto}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


export function IconoBarco() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0369a1" strokeWidth="1.8">
      <path d="M3 17l2 4h14l2-4H3z" />
      <path d="M5 17V9h14v8" />
      <path d="M9 9V5h6v4" />
    </svg>
  );
}

export function IconoStock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f9c70" strokeWidth="1.8">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

export function IconoCalidad() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="1.8">
      <path d="M12 2l7 3v6c0 5-3 8-7 11-4-3-7-6-7-11V5l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
