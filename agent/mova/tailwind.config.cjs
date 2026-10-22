/** Tailwind for the vendored Mova sources only; see src/mova.css. */
module.exports = {
  content: [`${__dirname}/src/**/*.{js,jsx}`],
  corePlugins: { preflight: false },
  // Utilities apply only inside a Mova root, so a page class such as
  // .hidden or .grid can never collide with one.
  important: '.mova',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', '-apple-system', 'system-ui', 'sans-serif'] },
    },
  },
};
