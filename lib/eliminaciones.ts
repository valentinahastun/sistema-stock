import { createClient } from "@/lib/supabase/server";

type Resultado = { ok: true } | { ok: false; error: string };

// Registra en log_eliminaciones qué se va a borrar, quién y cuándo,
// ANTES de borrarlo. Si el log falla, la función que llama debe
// abortar el borrado (no queremos que se pierda algo sin dejar rastro).
export async function registrarEliminacion(
  supabase: ReturnType<typeof createClient>,
  perfil: { id: string; nombre: string | null },
  tabla: string,
  registroId: string,
  datos: unknown
): Promise<Resultado> {
  const { error } = await supabase.from("log_eliminaciones").insert({
    tabla,
    registro_id: registroId,
    datos,
    eliminado_por: perfil.id,
    eliminado_por_nombre: perfil.nombre,
  });

  if (error) {
    return {
      ok: false,
      error: `No se pudo registrar el log de eliminación, así que no se borró nada: ${error.message}`,
    };
  }
  return { ok: true };
}
