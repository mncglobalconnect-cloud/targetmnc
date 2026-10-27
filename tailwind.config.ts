import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef5ff",
          100: "#d9e8ff",
          200: "#bcd7ff",
          300: "#8ebdff",
          400: "#5998ff",
          500: "#3372fb",
          600: "#1d53f0",
          700: "#153fdc",
          800: "#1834b2",
          900: "#1a318c",
          950: "#0f1d4f",
        },
        navy: { DEFAULT: "#0f1d3a", 700: "#1e2b4a", 500: "#475569" },
      },
      fontFamily: { sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(15,29,58,0.04), 0 1px 3px rgba(15,29,58,0.06)" },
    },
  },
  plugins: [],
} satisfies Config;
