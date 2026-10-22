// Mova typing-indicator, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Square dots in the muted ink and no pill behind them: the pill is for
// badges only.

import { motion } from 'framer-motion';

export function TypingIndicator() {
  return (
    <span className="mova-typing flex items-center py-1 space-x-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block w-1.5 h-1.5"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}
