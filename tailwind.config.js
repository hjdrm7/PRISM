/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{js,jsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#15181b",
          900: "#1b1f22",
          850: "#1e2327",
          800: "#252a2f",
          700: "#31373d",
          600: "#454d55",
          500: "#6b747c"
        },
        accent: {
          DEFAULT: "#37e0c4",
          dark: "#1fb69d",
          soft: "#37e0c433"
        }
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"]
      },
      borderRadius: {
        xl2: "1.25rem"
      }
    }
  },
  plugins: []
};
