/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Code"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          500: '#14b8a6', // Primary teal similar to MinIO
          600: '#0d9488',
          700: '#0f766e',
        },
        sidebar: {
          bg: '#0f172a', // slate-900
          hover: '#1e293b', // slate-800
          active: '#334155', // slate-700
          text: '#cbd5e1', // slate-300
          textActive: '#f8fafc', // slate-50
        }
      }
    },
  },
  plugins: [],
}
