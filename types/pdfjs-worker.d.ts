
// pdfjs-dist no publica declaraciones de tipos para el archivo del worker
// (solo para pdf.mjs). Lo importamos igual en app/api/cp/parse/route.ts
// para evitar el "fake worker" roto en el entorno serverless de Vercel;
// esta declaración le indica a TypeScript qué forma tiene ese módulo.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
