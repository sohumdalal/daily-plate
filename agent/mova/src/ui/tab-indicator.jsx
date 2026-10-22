// Mova pill-tabs, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova). Mova
// slides a pill behind the chosen tab with a shared layoutId; here the tabs
// are the page's own buttons, so the indicator is portalled into whichever
// one is `aria-current`, and it is the theme's Rosso underline, not a pill.

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

const current = (container) => container.querySelector('button[aria-current="true"]');

export function TabIndicator({ container }) {
  const id = useId();
  const [active, setActive] = useState(() => current(container));

  useEffect(() => {
    const observer = new MutationObserver(() => setActive(current(container)));
    observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    return () => observer.disconnect();
  }, [container]);

  if (!active) return null;
  return createPortal(
    <motion.span
      layoutId={`tab-indicator-${id}`}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="mova-tab-indicator pointer-events-none absolute left-0 right-0 -bottom-px h-px"
      aria-hidden="true"
    />,
    active,
  );
}
