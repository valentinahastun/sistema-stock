"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type Grupo = { nombre: string; base: string; items: { href: string; texto: string }[] };

// Menú de arriba: un desplegable por módulo (Operaciones, Stock, Calidad).
export default function MenuPrincipal({ grupos }: { grupos: Grupo[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);

  // Se cierra al cambiar de página o al hacer clic afuera
  useEffect(() => setAbierto(null), [path]);
  useEffect(() => {
    const cerrar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(null);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, []);

  const activo = (g: Grupo) => g.base.split("|").some((b) => path === b || path.startsWith(b + "/"));

  return (
    <nav ref={ref} className="flex gap-1 text-sm">
      {grupos.map((g) => (
        <div key={g.nombre} className="relative">
          <button
            onClick={() => setAbierto(abierto === g.nombre ? null : g.nombre)}
            className={
              "flex items-center gap-1 rounded-md px-3 py-1.5 hover:bg-white/10 " +
              (activo(g) ? "text-brand-green font-medium" : "")
            }
            aria-expanded={abierto === g.nombre}
          >
            {g.nombre}
            <span className="text-[10px] opacity-70" aria-hidden="true">▾</span>
          </button>
          {abierto === g.nombre && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] rounded-xl bg-white text-slate-700 shadow-lg ring-1 ring-slate-100 py-1.5">
              {g.items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className={
                    "block px-4 py-2 hover:bg-slate-50 " + (path === i.href ? "text-brand-green font-medium" : "")
                  }
                >
                  {i.texto}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
