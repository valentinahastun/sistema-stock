export default function SinAcceso({ email }: { email: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-8 max-w-lg mx-auto mt-10 text-center">
      <h1 className="text-lg font-semibold text-brand-navy mb-2">Todavía no tenés acceso</h1>
      <p className="text-sm text-gray-600">
        Entraste como <strong>{email}</strong>, pero esta cuenta no está habilitada para Operaciones Comex. Pedíselo a Valentina o a Lourdes.
      </p>
    </div>
  );
}
