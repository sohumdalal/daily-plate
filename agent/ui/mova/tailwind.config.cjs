/** Tailwind for the vendored Mova sources only; see src/mova.css. */
module.exports = {
  content: [`${__dirname}/src/**/*.{js,jsx}`],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', '-apple-system', 'system-ui', 'sans-serif'] },
    },
  },
};
