import Link from "next/link";

export default function NoEncontrada() {
  return (
    <div className="bg-white rounded-lg shadow p-8 text-center">
      <p className="text-sm text-gray-600">No encontré esa operación.</p>
      <Link href="/operaciones" className="text-sm text-brand-navy underline">Volver a operaciones</Link>
    </div>
  );
}
