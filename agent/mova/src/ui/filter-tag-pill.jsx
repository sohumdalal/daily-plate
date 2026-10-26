// Mova FilterTagPill (Floating Filter Tag Pill), from @mova-ui/react 0.4.6
// (MIT, see LICENSE.mova). Re-skinned for Daily Plate: colour and radius are
// the theme tokens. Mova's demo keeps its three tags and the choice itself;
// here the page passes the tags, each with its count, and owns the choice.

import { motion } from 'framer-motion';

export function FilterTagPill({ tags, selected, onSelect }) {
  // One stop in the tab order; the arrow keys move along the pill.
  const step = (e) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by) return;
    e.preventDefault();
    const at = tags.findIndex((t) => t.value === selected);
    const next = tags[(at + by + tags.length) % tags.length];
    onSelect(next.value);
    e.currentTarget.querySelector(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <div role="group" aria-label="Section" onKeyDown={step} className="flex items-center gap-1 p-1 border dp-pill">
      {tags.map((tag) => (
        <button
          key={tag.value}
          type="button"
          data-value={tag.value}
          aria-pressed={selected === tag.value}
          tabIndex={selected === tag.value ? 0 : -1}
          onClick={() => onSelect(tag.value)}
          className="relative shrink-0 px-3 py-1.5 text-xs font-semibold cursor-pointer border-0 bg-transparent whitespace-nowrap"
        >
          {selected === tag.value && (
            <motion.div
              layoutId="filter-tag-pill"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              className="absolute inset-0 dp-pill-on"
            />
          )}
          <span className={`relative z-10 ${selected === tag.value ? 'dp-pill-text-on font-bold' : 'dp-pill-text'}`}>
            {tag.label}
            <span className="ml-1.5 tabular-nums opacity-60">{tag.count}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
