import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any sub-path - GitHub Pages serves a project
// site under /<repo>/, and a local `vite preview` serves it from the root. The router is
// hash-based for the same reason: a static host has no server to rewrite deep links.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
