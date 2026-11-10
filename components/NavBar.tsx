import Link from "next/link";
import Image from "next/image";
import { getAccesos } from "@/lib/accesos";
import LogoutButton from "@/components/LogoutButton";
import MenuPrincipal, { type Grupo } from "@/components/MenuPrincipal";

export default async function NavBar() {
  const a = await getAccesos();
  if (!a) return null;
  const admin = a.perfil?.rol === "admin";

  const grupos: Grupo[] = [];
  if (a.operaciones) {
    grupos.push({
      nombre: "Operaciones",
      base: "/operaciones",
      items: [
        { href: "/operaciones", texto: "Inicio" },
        { href: "/operaciones/lista", texto: "Operaciones abiertas" },
      ],
    });
  }
  if (a.stock) {
    grupos.push({
      nombre: "Stock",
      base: "/stock|/procesos|/ingresos|/egresos|/movimientos|/catalogos",
      items: [
        { href: "/stock", texto: "Stock" },
        { href: "/procesos", texto: "Procesos" },
        { href: "/ingresos", texto: "Ingresos" },
        { href: "/egresos", texto: "Egresos" },
        ...(admin
          ? [
              { href: "/movimientos", texto: "Cargar movimiento" },
              { href: "/catalogos", texto: "Catálogos" },
            ]
          : []),
      ],
    });
  }
  if (a.calidad) {
    grupos.push({
      nombre: "Calidad",
      base: "/calidad",
      items: [
        { href: "/calidad", texto: "Calidad" },
        ...(admin || a.perfil?.rol === "calidad" ? [{ href: "/calidad/cargar", texto: "Cargar calidad" }] : []),
      ],
    });
  }

  return (
    <header className="border-b bg-brand-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="Inicio">
            <Image src="/logo.png" alt="ARGREEN" width={100} height={29} />
          </Link>
          <MenuPrincipal grupos={grupos} />
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-200">
          <span>{a.nombre}</span>
          <Link href="/contrasena" className="text-gray-300 hover:text-white underline">
            Contraseña
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
