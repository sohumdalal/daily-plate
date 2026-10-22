// True when the viewer asked their system for less motion. Recharts and the
// CSS-driven loops do not read Motion's MotionConfig, so they read this.
export const REDUCED =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
