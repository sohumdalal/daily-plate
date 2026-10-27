// Mova CardGlancePreview (Card Glance Preview), from @mova-ui/react 0.4.6
// (MIT, see LICENSE.mova). Re-skinned for Daily Plate: colour and radius are
// the theme tokens. Mova's demo shows one fixed line over an info button;
// here the trigger is what the page wraps, a chart's badge, and the text is
// the page's, which wraps. The card is drawn over the page, under the
// trigger, since a chart card clips anything past its edge. Added: it opens
// on keyboard focus too.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

const WIDTH = 240;
const GUTTER = 16;

export function InfoTip({ text, children }) {
  const [at, setAt] = useState(null);
  const trigger = useRef(null);
  const id = useId();
  const show = () => {
    const r = trigger.current.getBoundingClientRect();
    // Under the trigger, kept inside the window.
    setAt({ left: Math.max(GUTTER, Math.min(r.left, innerWidth - WIDTH - GUTTER)), top: r.bottom + 6 });
  };
  const hide = () => setAt(null);
  // The card is fixed to the window, so a scroll would leave it behind.
  useEffect(() => {
    if (!at) return;
    addEventListener('scroll', hide, { passive: true, once: true });
    return () => removeEventListener('scroll', hide);
  }, [at]);
  return (
    <span
      ref={trigger}
      className="relative inline-flex cursor-help"
      tabIndex={0}
      aria-describedby={at ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {createPortal(
        <span className="mova">
          <AnimatePresence>
            {at && (
              <motion.span
                id={id}
                role="tooltip"
                initial={{ opacity: 0, y: -2, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -2, scale: 0.94 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                style={{ position: 'fixed', left: at.left, top: at.top, width: WIDTH }}
                className="px-3 py-2 border text-[11px] leading-snug normal-case tracking-normal font-normal shadow-xl flex items-start gap-2 z-50 pointer-events-none origin-top-left dp-glance"
              >
                <span className="mt-1 w-1.5 h-1.5 shrink-0 rounded-full dp-glance-dot" />
                <span>{text}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>,
        document.body,
      )}
    </span>
  );
}
