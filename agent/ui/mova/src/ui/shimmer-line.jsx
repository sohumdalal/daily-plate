// Mova shimmer-line, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova): a
// short bar running along a track. Here the track is the nav's bottom rule,
// full width and 2px, and the bar is Rosso Corsa.

import { motion } from 'framer-motion';

export function ShimmerLine() {
  return (
    <div className="mova-shimmer-line w-full h-full overflow-hidden relative">
      <motion.div
        className="absolute top-0 left-0 bottom-0 w-1/3"
        animate={{ x: ['-100%', '300%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
