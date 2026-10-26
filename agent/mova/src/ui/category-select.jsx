// Mova CategorySelect (Category Dropdown), from @mova-ui/react 0.4.6 (MIT,
// see LICENSE.mova). Re-skinned for Daily Plate: colour and radius are the
// theme tokens. Mova's demo keeps three categories and the choice itself;
// here the page passes the options, each with its count, and owns the
// choice. Added: a click outside or Escape closes it, and the button names
// what it filters ("Repo All").

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';

export function CategorySelect({ label, options, selected, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef(null);
  const current = options.find((opt) => opt.value === selected) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;
    const away = (e) => root.current?.contains(e.target) || setIsOpen(false);
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [isOpen]);

  // Escape closes the menu and goes no further, so the page's own Escape
  // (clear the filters) waits for the next press.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !isOpen) return;
    e.stopPropagation();
    setIsOpen(false);
  };

  return (
    <div ref={root} onKeyDown={onKeyDown} className="relative flex flex-col items-start select-none">
      <motion.button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        whileTap={{ scale: 0.96 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-3 px-3 py-1.5 border text-xs font-semibold transition-all cursor-pointer dp-select ${selected ? 'dp-select-on' : ''}`}
      >
        <span>
          <span className="font-normal dp-muted">{label} </span>
          {current.label}
        </span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-3.5 h-3.5 dp-muted" />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.95 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-0 z-30 min-w-[200px] p-1 border shadow-xl flex flex-col gap-0.5 dp-menu"
          >
            {options.map((opt) => (
              <button
                key={opt.value ?? ''}
                type="button"
                role="menuitemradio"
                aria-checked={selected === opt.value}
                onClick={() => {
                  onSelect(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs font-medium transition-colors cursor-pointer border-0 ${
                  selected === opt.value ? 'dp-option-on font-semibold' : 'dp-option'
                }`}
              >
                <span className="flex-1">{opt.label}</span>
                {opt.count != null && <span className="tabular-nums opacity-60">{opt.count}</span>}
                <Check className={`w-3.5 h-3.5 ${selected === opt.value ? '' : 'invisible'}`} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
