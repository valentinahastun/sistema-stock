import Link from "next/link";
import Image from "next/image";
import { getPerfilActual } from "@/lib/supabase/profile";
import LogoutButton from "@/components/LogoutButton";

export default async function NavBar() {
  const perfil = await getPerfilActual();

  if (!perfil) return null;

  return (
    <header className="border-b bg-brand-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Image src="/logo.png" alt="ARGREEN" width={100} height={29} />
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="hover:text-brand-green">
              Panel
            </Link>
            {perfil.rol !== "calidad" && (
              <Link href="/stock" className="hover:text-brand-green">
                Stock
              </Link>
            )}
            <Link href="/calidad" className="hover:text-brand-green">
              Calidad
            </Link>
            {perfil.rol !== "calidad" && (
              <>
                <Link href="/ingresos" className="hover:text-brand-green">
                  Ingresos
                </Link>
                <Link href="/egresos" className="hover:text-brand-green">
                  Egresos
                </Link>
              </>
            )}
            {perfil.rol === "admin" && (
              <Link href="/movimientos" className="hover:text-brand-green">
                Cargar movimiento
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-200">
          <span>
            {perfil.nombre ?? "Usuario"} ·{" "}
            {perfil.rol === "admin"
              ? "Administrador"
              : perfil.rol === "calidad"
              ? "Calidad"
              : "Consulta"}
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
