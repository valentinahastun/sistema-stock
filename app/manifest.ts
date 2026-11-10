import type { MetadataRoute } from "next";

// Para instalarla en el teléfono como app ("Agregar a pantalla de inicio")
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plataforma Argreen",
    short_name: "Argreen",
    description: "Stock, calidad y operaciones de Argreen",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
