/**
 * Mova components on the plain-JS pages: `bun run build:ui` writes this to
 * /mova/dist/index.js, which sets `window.Mova`.
 *
 * The pages stay plain DOM. Each call mounts a small React root inside an
 * element the page already owns, so the page keeps its own listeners,
 * `disabled` and `hidden`, and works unchanged if this bundle never loads.
 * Anything that writes the element's text itself must `release` it first.
 */

import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import { SubmitState } from './ui/submit-state.jsx';
import { TypingIndicator } from './ui/typing.jsx';
import { TextShimmer } from './ui/shimmer.jsx';
import { TabIndicator } from './ui/tab-indicator.jsx';
import { FilterTagPill } from './ui/filter-tag-pill.jsx';
import { CategorySelect } from './ui/category-select.jsx';
import { ShimmerLine } from './ui/shimmer-line.jsx';
import { PageSkeleton } from './ui/skeletons.jsx';

const roots = new WeakMap();

function render(el, node) {
  let root = roots.get(el);
  if (!root) {
    el.replaceChildren();
    el.classList.add('mova');
    root = createRoot(el);
    roots.set(el, root);
  }
  // Mova's motion stands still for anyone who asked their system for less.
  root.render(<MotionConfig reducedMotion="user">{node}</MotionConfig>);
}

function release(el) {
  const root = roots.get(el);
  if (!root) return;
  root.unmount();
  roots.delete(el);
}

/** A button's contents: its label, then a spinner, a drawn check, or a shake. */
const labels = new WeakMap();
function button(el, { state = 'idle', label, pending, done } = {}) {
  const prev = labels.get(el) ?? { label: el.textContent.trim() };
  const next = {
    label: label ?? prev.label,
    pending: pending ?? prev.pending,
    done: done ?? prev.done,
  };
  labels.set(el, next);
  render(el, <SubmitState state={state} stamp={Date.now()} {...next} />);
}

/** Bouncing dots, for a reply being composed. */
function typing(el) {
  render(el, <TypingIndicator />);
}

/** Work in progress said in words, with the light passing over them. */
function shimmer(el, text) {
  render(el, <TextShimmer text={text} />);
}

/** A page's loading shape: day, rollup, charts, goals, feedback or plate. */
function skeleton(el, shape, period) {
  render(el, <PageSkeleton shape={shape} period={period} />);
}

/**
 * The bar along the nav's bottom rule while anything is read. Calls are
 * counted, so two overlapping loads keep it running until both finish.
 */
const loads = new WeakMap();
function progress(el, on) {
  const n = Math.max(0, (loads.get(el) ?? 0) + (on ? 1 : -1));
  loads.set(el, n);
  render(el, n > 0 ? <ShimmerLine /> : null);
}

/** The current tab's underline slides to the next one instead of jumping. */
function tabs(container) {
  if (roots.has(container)) return;
  const host = document.createElement('span');
  host.hidden = true;
  container.append(host);
  container.classList.add('mova', 'mova-tabs');
  const root = createRoot(host);
  roots.set(container, root);
  root.render(
    <MotionConfig reducedMotion="user">
      <TabIndicator container={container} />
    </MotionConfig>,
  );
}

/** The section filter: tags with their counts, the chosen one's backdrop sliding to the next. */
function filterPill(el, props) {
  render(el, <FilterTagPill {...props} />);
}

/** A filter's dropdown: `Repo All ▾`, with what each choice would leave. */
function categorySelect(el, props) {
  render(el, <CategorySelect {...props} />);
}

/** A week, month or year's charts. The chart code loads on first use. */
let rollups;
const latest = new WeakMap();
async function rollup(el, stats) {
  // A failed load (a deploy replaced the chunk) is retried on the next call.
  rollups ??= import('./rollups/index.jsx').catch((err) => {
    rollups = null;
    throw err;
  });
  latest.set(el, stats);
  const { Rollup, hasActivity } = await rollups;
  // Paging quickly can resolve calls out of order; only the newest renders.
  if (latest.get(el) !== stats) return;
  el.hidden = !stats || !hasActivity(stats);
  if (el.hidden) return release(el);
  render(el, <Rollup stats={stats} />);
}

window.Mova = { button, typing, shimmer, tabs, filterPill, categorySelect, rollup, skeleton, progress, release };
