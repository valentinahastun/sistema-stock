"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setCargando(false);

    if (error) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError("No se pudo iniciar sesión con Google.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-green-light">
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex justify-center mb-2">
          <Image src="/logo.png" alt="ARGREEN" width={160} height={47} priority />
        </div>
        <h1 className="text-lg font-semibold text-center text-brand-navy">
          Sistema de Stock
        </h1>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-2 border rounded py-2 text-sm text-brand-navy hover:bg-gray-50"
        >
          <GoogleIcon />
          Iniciar sesión con Google
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex-1 border-t" />
          o con tu usuario
          <span className="flex-1 border-t" />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Usuario</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="tu@correo.com"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">
            Contraseña
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="w-full bg-brand-green hover:bg-brand-green-dark text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {cargando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3c-7.4 0-13.8 4.1-17.1 10.2z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.6C29.5 35.8 26.9 36.8 24 36.8c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.9 40.6 16.4 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.6h.01l6.6 5.6C37.1 39.9 44 34.5 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
