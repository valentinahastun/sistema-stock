// Se muestra apenas se hace clic en otra pantalla, mientras el servidor
// trae los datos: así no parece que la página quedó trabada.
export default function Cargando() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Cargando">
      <div className="h-6 w-48 bg-gray-200 rounded mb-5" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-white rounded-lg shadow p-4">
            <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
            <div className="h-5 w-16 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 bg-gray-100 rounded" style={{ width: `${95 - i * 6}%` }} />
        ))}
      </div>
    </div>
  );
}
