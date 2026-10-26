// Mova search-expand (Search Expand), from @mova-ui/react 0.4.6 (MIT, see
// LICENSE.mova). Re-skinned for Daily Plate: colour and radius are the theme
// tokens. Mova's demo keeps its text and a fixed placeholder; here the page
// passes both and hears each keystroke. Added: a clear ×, Escape clears the
// text and then lets go of the focus, and `/` from anywhere focuses it.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';

export function SearchExpand({ value, placeholder, onChange }) {
  const [isFocused, setIsFocused] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    const slash = (e) => {
      if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', slash);
    return () => document.removeEventListener('keydown', slash);
  }, []);

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    // The page's own Escape (clear the filters) waits for the next press.
    e.stopPropagation();
    if (value) onChange('');
    else input.current?.blur();
  };

  const open = isFocused || Boolean(value);
  return (
    <motion.div
      animate={{ width: open ? 280 : 200 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="relative flex items-center border px-3 py-1.5 transition-colors max-w-full dp-search"
    >
      <Search className="w-4 h-4 shrink-0 mr-2 dp-muted" />
      <input
        ref={input}
        type="search"
        aria-label="Search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="w-full min-w-0 text-xs bg-transparent border-0 outline-none dp-ink"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          className="shrink-0 ml-1 p-0 border-0 bg-transparent cursor-pointer dp-muted"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
}
