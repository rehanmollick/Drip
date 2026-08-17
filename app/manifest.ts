import type { MetadataRoute } from "next";

/** Served at /manifest.webmanifest (referenced from app/layout.tsx metadata). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "drip",
    short_name: "drip",
    description: "paste anything. scroll it in.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
