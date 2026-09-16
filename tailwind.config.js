/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./public/**/*.{html,js}"  // Simplified: already covers all subdirectories
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        space: {
          950: 'rgb(var(--color-space-950-rgb, 9 9 11) / <alpha-value>)',
          900: 'rgb(var(--color-space-900-rgb, 15 15 17) / <alpha-value>)',
          850: 'rgb(var(--color-space-850-rgb, 18 18 20) / <alpha-value>)',
          800: 'rgb(var(--color-space-800-rgb, 24 24 27) / <alpha-value>)',
          border: 'rgb(var(--color-space-border-rgb, 39 39 42) / <alpha-value>)'
        },
        neon: {
          purple: 'rgb(var(--color-neon-purple-rgb, 139 92 246) / <alpha-value>)',
          cyan: 'rgb(var(--color-neon-cyan-rgb, 6 182 212) / <alpha-value>)',
          green: 'rgb(var(--color-neon-green-rgb, 16 185 129) / <alpha-value>)',
          yellow: 'rgb(var(--color-neon-yellow-rgb, 245 158 11) / <alpha-value>)',
          red: 'rgb(var(--color-neon-red-rgb, 239 68 68) / <alpha-value>)'
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('daisyui')
  ],
  daisyui: {
    themes: [
      {
        antigravity: {
          "primary": "#3b82f6",    // Modern blue accent
          "secondary": "#10b981",  // Emerald green
          "accent": "#06b6d4",     // Cyan
          "neutral": "#1e293b",    // Slate 800
          "base-100": "#0b0f19",   // Modern deep slate canvas
          "info": "#38bdf8",       // Sky
          "success": "#10b981",    // Emerald
          "warning": "#f59e0b",    // Amber
          "error": "#ef4444",      // Red
        },
        "antigravity-light": {
          "primary": "#2563eb",    // Royal blue
          "secondary": "#059669",  // Clean green
          "accent": "#0284c7",     // Sky blue
          "neutral": "#f1f5f9",    // Slate 100
          "base-100": "#f8fafc",   // Pure crisp slate-50 canvas
          "info": "#2563eb",       // Blue
          "success": "#059669",    // Green
          "warning": "#d97706",    // Amber
          "error": "#dc2626",      // Red
        }
      }
    ],
    logs: false  // Disable console logs in production
  }
}
