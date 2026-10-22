// Mova mono-rounded-bar, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedBarChart.tsx
import { REDUCED } from "../reduced.js";
import { useState as useState2 } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell
} from "recharts";

// src/components/dither-charts/lib/recharts-tooltip.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function DitherChartTooltipContent({
  active,
  payload,
  label,
  theme = "dark",
  indicator = "dot",
  formatter
}) {
  if (!active || !payload || payload.length === 0) return null;
  const isDark = theme === "dark";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `px-3 py-2 text-xs border transition-all pointer-events-none font-sans z-50 ${"dp-card"}`,
      children: [
        label && /* @__PURE__ */ jsx("div", { className: `font-medium mb-1.5 pb-1 border-b tracking-tight ${"dp-rule dp-tip-label"}`, children: label }),
        /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-1", children: payload.map((item, idx) => {
          const color = item.color || item.fill || (isDark ? "#FFFFFF" : "#000000");
          const valueDisplay = formatter ? formatter(item.value, item.name) : typeof item.value === "number" ? item.value.toLocaleString() : item.value;
          return /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-3", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
              indicator === "dot" && /* @__PURE__ */ jsx(
                "span",
                {
                  className: "w-2 h-2 rounded-full",
                  style: { backgroundColor: color }
                }
              ),
              indicator === "line" && /* @__PURE__ */ jsx(
                "span",
                {
                  className: "w-2.5 h-0.5 rounded-full",
                  style: { backgroundColor: color }
                }
              ),
              /* @__PURE__ */ jsxs("span", { className: `font-normal ${"dp-muted"}`, children: [
                item.name || item.dataKey,
                ":"
              ] })
            ] }),
            /* @__PURE__ */ jsx("span", { className: "font-semibold tabular-nums", children: valueDisplay })
          ] }, idx);
        }) })
      ]
    }
  );
}

// src/hooks/useIsMobile.ts
import { useState, useEffect } from "react";
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < breakpoint || window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = (e) => {
      setIsMobile(e.matches);
    };
    setIsMobile(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } else {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, [breakpoint]);
  return isMobile;
}

// src/components/mono-charts/MonoRoundedBarChart.tsx
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var MONO_BAR_DATA__DEMO = [
  { label: "Mon", primary: 45, secondary: 25 },
  { label: "Tue", primary: 78, secondary: 40 },
  { label: "Wed", primary: 62, secondary: 30 },
  { label: "Thu", primary: 95, secondary: 55 },
  { label: "Fri", primary: 88, secondary: 50 },
  { label: "Sat", primary: 54, secondary: 28 }
];
function MonoRoundedBarChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint }) {
  const MONO_BAR_DATA = data ?? MONO_BAR_DATA__DEMO;
  const isDark = theme === "dark";
  const isMobile = useIsMobile();
  // Daily Plate: Mova's Col/Row demo switch is a legend here.
  const isHorizontal = false;
  const LEGEND = [[names?.[0] ?? "Primary Output", "var(--ink)"], [names?.[1] ?? "Secondary Output", "rgba(var(--ink-rgb),0.2)"]];
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-between mb-2", children: [
          /* @__PURE__ */ jsxs2("div", { children: [
            /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx2("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Mono Pill Pillars" }),
              /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Full Radius" })
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
              "422 ",
              ]), /* @__PURE__ */ jsx2("span", { className: "text-xs font-normal opacity-70", children: unit ?? "units built" })
            ] })
          ] }),
          /* @__PURE__ */ jsx2("div", { className: "flex items-center gap-3 text-[11px] dp-muted", children: LEGEND.map(([n, fill]) => /* @__PURE__ */ jsxs2("span", { className: "inline-flex items-center gap-1.5", children: [/* @__PURE__ */ jsx2("span", { className: "w-2 h-2 inline-block", style: { background: fill } }), n] }, n)) })
        ] }),
        /* @__PURE__ */ jsx2("div", { className: `relative w-full flex-1 overflow-hidden p-2 transition-colors duration-300 touch-pan-y ${"dp-well"}`, children: /* @__PURE__ */ jsx2(ResponsiveContainer, { width: "100%", height: compact ? 130 : 160, children: /* @__PURE__ */ jsxs2(
          BarChart,
          {
            data: MONO_BAR_DATA,
            layout: isHorizontal ? "vertical" : "horizontal",
            margin: { top: 12, right: 12, left: isHorizontal ? 0 : -22, bottom: 0 },
            children: [
              /* @__PURE__ */ jsx2(
                CartesianGrid,
                {
                  strokeDasharray: "2 2",
                  vertical: false,
                  stroke: "var(--hairline)"
                }
              ),
              isHorizontal ? /* @__PURE__ */ jsxs2(Fragment, { children: [
                /* @__PURE__ */ jsx2(XAxis, { type: "number", hide: true }),
                /* @__PURE__ */ jsx2(YAxis, { dataKey: "label", type: "category", tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--muted)" } })
              ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
                /* @__PURE__ */ jsx2(XAxis, { dataKey: "label", tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--muted)" } }),
                /* @__PURE__ */ jsx2(YAxis, { tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--muted)" } })
              ] }),
              /* @__PURE__ */ jsx2(Tooltip, { content: /* @__PURE__ */ jsx2(DitherChartTooltipContent, { theme, indicator: "dot" }) }),
              /* @__PURE__ */ jsx2(
                Bar,
                {
                  dataKey: "primary",
                  name: names?.[0] ?? "Primary Output",
                  fill: "var(--ink)",
                  radius: 0,
                  barSize: isHorizontal ? 12 : 16,
                  isAnimationActive: !isMobile && !REDUCED,
                  animationDuration: isMobile ? 0 : 800,
                  // Daily Plate's one accent marks a single bar, e.g. the peak day.
                  children: MONO_BAR_DATA.map((d, i) => /* @__PURE__ */ jsx2(Cell, { fill: i === highlight ? "var(--primary)" : "var(--ink)" }, i))
                }
              ),
              /* @__PURE__ */ jsx2(
                Bar,
                {
                  dataKey: "secondary",
                  name: names?.[1] ?? "Secondary Output",
                  fill: "rgba(var(--ink-rgb),0.2)",
                  radius: 0,
                  barSize: isHorizontal ? 12 : 16,
                  isAnimationActive: !isMobile && !REDUCED,
                  animationDuration: isMobile ? 0 : 1e3
                }
              )
            ]
          }
        ) }) }),
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx2("span", { className: "dp-muted", children: footL ?? "Corner Radius: 8px All" }),
          /* @__PURE__ */ jsx2("span", { className: "dp-ink font-medium", children: footR ?? "Monochrome Fill" })
        ] })
      ]
    }
  );
}

export default MonoRoundedBarChart;
