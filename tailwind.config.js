/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Semantic colors. Their values live in src/index.css and switch for dark mode there.
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        line: token('line'),
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        accent: { DEFAULT: token('accent'), ink: token('accent-ink') },
        primary: token('accent'),
        danger: token('danger'),
        warn: token('warn'),
        success: token('success'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 1px rgb(var(--line) / 1)',
        pop: '0 12px 32px -8px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--line) / 1)',
      },
    },
  },
  plugins: [],
}
