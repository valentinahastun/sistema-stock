"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

// Dos formas de entrar: con contraseña, o con un link que llega por mail
// (para cuando no se acuerda la contraseña). El login con Google no está
// activado en Supabase, por eso no aparece.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [modo, setModo] = useState<"link" | "clave">("link");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function entrarConClave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function mandarLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setCargando(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    setCargando(false);
    if (error) {
      setError(
        /signups not allowed|not found/i.test(error.message)
          ? "Ese mail no tiene usuario. Pedíselo a Valentina."
          : "No se pudo mandar el link: " + error.message
      );
      return;
    }
    setAviso(`Listo. Te mandamos un link a ${email.trim()}. Abrilo desde esta misma compu para entrar.`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-green-light">
      <form
        onSubmit={modo === "link" ? mandarLink : entrarConClave}
        className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex justify-center mb-2">
          <Image src="/logo.png" alt="ARGREEN" width={160} height={47} priority />
        </div>
        <h1 className="text-lg font-semibold text-center text-brand-navy">Tracking Comex</h1>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Tu mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="nombre@argreen.com.ar"
          />
        </div>

        {modo === "clave" && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {aviso && <p className="text-sm text-green-700">{aviso}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="w-full bg-brand-green hover:bg-brand-green-dark text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {cargando ? "Un momento…" : modo === "link" ? "Mandarme un link para entrar" : "Ingresar"}
        </button>

        <button
          type="button"
          onClick={() => {
            setModo(modo === "link" ? "clave" : "link");
            setError(null);
            setAviso(null);
          }}
          className="w-full text-sm text-brand-navy hover:underline"
        >
          {modo === "link" ? "Prefiero entrar con contraseña" : "No me acuerdo la contraseña: mandame un link"}
        </button>
      </form>
    </div>
  );
}
