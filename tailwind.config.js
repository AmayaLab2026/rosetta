/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Claude warm paper & parchment palette
        background: '#FAF9F5',
        foreground: '#1F1E1D',
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F5F3ED',
          border: '#E5E0D8',
          hover: '#F0ECE4',
          active: '#E8E3DA'
        },
        brand: {
          DEFAULT: '#CC785C', // Claude signature warm terracotta
          hover: '#B86348',
          accent: '#DA7756',
          subtle: '#FAF1ED',
          border: '#F1D3C8'
        },
        telegram: {
          DEFAULT: '#0284C7',
          subtle: '#F0F9FF',
          border: '#BAE6FD'
        },
        twitter: {
          DEFAULT: '#0284C7',
          dark: '#0F1419',
          subtle: '#F8FAFC',
          border: '#E2E8F0'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace']
      },
      boxShadow: {
        'panel': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        'panel-card': '0 2px 8px -2px rgba(31, 30, 29, 0.06), 0 1px 3px -1px rgba(31, 30, 29, 0.04)',
        'glow-terracotta': '0 4px 14px -2px rgba(204, 120, 92, 0.22)'
      }
    },
  },
  plugins: [],
}
