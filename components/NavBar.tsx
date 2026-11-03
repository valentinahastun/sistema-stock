import Link from "next/link";
import Image from "next/image";
import { getUsuario } from "@/lib/usuario";
import { NOMBRE_RESPONSABLE } from "@/lib/pasos";
import LogoutButton from "@/components/LogoutButton";
import { createClient } from "@/lib/supabase/server";

export default async function NavBar() {
  const u = await getUsuario();
  if (!u) return null;
  let pendientes = 0;
  if (u.acceso) {
    const { count } = await createClient()
      .from("op_mails")
      .select("id", { count: "exact", head: true })
      .eq("estado", "pendiente");
    pendientes = count ?? 0;
  }

  return (
    <header className="border-b bg-brand-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Image src="/logo.png" alt="ARGREEN" width={100} height={29} />
          <span className="text-sm font-semibold">Operaciones Comex</span>
          {u.acceso && (
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-brand-green">Inicio</Link>
              <Link href="/operaciones" className="hover:text-brand-green">Operaciones</Link>
              <Link href="/por-confirmar" className="hover:text-brand-green">
                Del mail
                {pendientes > 0 && (
                  <span className="ml-1 rounded-full bg-amber-400 text-brand-navy text-xs font-semibold px-1.5">{pendientes}</span>
                )}
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-200">
          <span>
            {u.acceso?.responsable ? NOMBRE_RESPONSABLE[u.acceso.responsable] : u.email}
            {u.acceso ? (u.acceso.rol === "editor" ? " · Edición" : " · Solo lectura") : ""}
          </span>
          <Link href="/contrasena" className="text-gray-300 hover:text-white underline">Contraseña</Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
