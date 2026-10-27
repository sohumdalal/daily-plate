// Mova CardGlancePreview (Card Glance Preview), from @mova-ui/react 0.4.6
// (MIT, see LICENSE.mova). Re-skinned for Daily Plate: colour and radius are
// the theme tokens, and the button is the size of a chart's badge. Mova's
// demo shows one fixed line above the button; here the page passes the text,
// which wraps, and the card drops below the button, since a chart card clips
// anything above its edge. Added: it opens on keyboard focus too.

import { useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info } from 'lucide-react';

export function InfoTip({ text, label = 'What this shows' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span className="relative inline-flex">
      <motion.button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        className="w-5 h-5 p-0 border-0 bg-transparent flex items-center justify-center cursor-help dp-muted"
      >
        <Info className="w-3.5 h-3.5" />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.92 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.92 }}
            className="absolute top-full left-0 w-[240px] px-3 py-2 border text-[11px] leading-snug normal-case tracking-normal font-normal shadow-xl flex items-start gap-2 z-20 pointer-events-none dp-glance"
          >
            <span className="mt-1 w-1.5 h-1.5 shrink-0 rounded-full dp-glance-dot" />
            <span>{text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
