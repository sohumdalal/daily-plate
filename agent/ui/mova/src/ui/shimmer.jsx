// Mova text-shimmer, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova), with
// the text as a prop: muted words, and the ink passing over them.

import { motion } from 'framer-motion';

export function TextShimmer({ text }) {
  return (
    <span className="mova-shimmer relative inline-block">
      {text}
      <motion.span
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          maskImage: 'linear-gradient(90deg, transparent 0%, black 50%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 50%, transparent 100%)',
          maskSize: '200% 100%',
          WebkitMaskSize: '200% 100%',
        }}
        animate={{ maskPosition: ['100% 0%', '-100% 0%'], WebkitMaskPosition: ['100% 0%', '-100% 0%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      >
        {text}
      </motion.span>
    </span>
  );
}
