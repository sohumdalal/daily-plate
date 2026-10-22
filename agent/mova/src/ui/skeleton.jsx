// Mova skeleton, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova): a block
// with a soft sweep passing over it. Sharp, on the theme's hairline, with the
// sweep in the ink at low strength, so one component serves both themes.

import { motion } from 'framer-motion';

const SWEEP =
  'linear-gradient(90deg, rgba(var(--ink-rgb),0) 0%, rgba(var(--ink-rgb),0.06) 50%, rgba(var(--ink-rgb),0) 100%)';

export function Skeleton({ className = '', style }) {
  return (
    <div className={`mova-skeleton relative overflow-hidden ${className}`} style={style}>
      <motion.div
        initial={{ x: '-150%' }}
        animate={{ x: '150%' }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        style={{ background: SWEEP }}
        className="absolute inset-0 w-[80%] h-full"
      />
    </div>
  );
}
