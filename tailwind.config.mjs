/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        sans: ["'Inter'", "sans-serif"],
      },
      colors: {
        brand: {
          50:  "#ecfdf5",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
      },
    },
  },
  plugins: [],
};
