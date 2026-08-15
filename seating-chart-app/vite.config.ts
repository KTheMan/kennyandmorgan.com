import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Published as a static subfolder of the main site (kennyandmorgan.com
// GitHub Pages deploy copies this build's `dist/` to `/seating-chart/`),
// so asset URLs must stay relative rather than rooted at `/`.
export default defineConfig(({ mode }) => ({
  base: "./",
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));
