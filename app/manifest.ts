import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "夜航信箱｜AI 陪伴",
    short_name: "夜航信箱",
    description: "会记得、会回应，也尊重边界的 AI 陪伴空间。",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f0e7",
    theme_color: "#171925",
    orientation: "portrait",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
