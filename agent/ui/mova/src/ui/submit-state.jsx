// Mova form-submit-button, success-check and error-shake, from @mova-ui/react
// 0.4.6 (MIT, see LICENSE.mova), as one button's contents. Mova's demo keeps
// the state itself; here the page passes it in, and the button around these
// contents stays the page's own `.btn` or `.line-button`.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

/** How long the check stays before the label comes back. */
const DONE_MS = 1400;

export function SubmitState({ state, stamp, label, pending, done }) {
  const [shown, setShown] = useState(state);

  useEffect(() => {
    setShown(state);
    if (state !== 'success') return;
    const t = setTimeout(() => setShown('idle'), DONE_MS);
    return () => clearTimeout(t);
  }, [state, stamp]);

  return (
    <motion.span
      className="mova-submit inline-flex items-center justify-center gap-2"
      animate={shown === 'error' ? { x: [-10, 10, -8, 8, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.5 }}
      key={shown === 'error' ? stamp : 'steady'}
    >
      {shown === 'loading' ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>{pending ?? label}</span>
        </>
      ) : shown === 'success' ? (
        <>
          <AnimatePresence>
            <motion.svg
              key="check"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              aria-hidden="true"
            >
              <motion.path
                d="M20 6L9 17l-5-5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3 }}
              />
            </motion.svg>
          </AnimatePresence>
          <span>{done ?? label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </motion.span>
  );
}
