// Mova mono-rounded-area, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedAreaChart.tsx
import { REDUCED } from "../reduced.js";
import { InfoTip } from "../ui/info-tip.jsx";
import { useState as useState2, useId } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
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

// src/components/mono-charts/MonoRoundedAreaChart.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var MONO_AREA_DATA__DEMO = [
  { time: "02:00", volume: 18 },
  { time: "06:00", volume: 34 },
  { time: "10:00", volume: 72 },
  { time: "14:00", volume: 89 },
  { time: "18:00", volume: 64 },
  { time: "22:00", volume: 48 }
];
function MonoRoundedAreaChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint, info }) {
  const MONO_AREA_DATA = data ?? MONO_AREA_DATA__DEMO;
  const isDark = theme === "dark";
  const isMobile = useIsMobile();
  const idPrefix = useId().replace(/:/g, "");
  // Daily Plate: Mova's Monotone/Natural demo switch is removed.
  const curve = "monotone";
  const latestVal = MONO_AREA_DATA[MONO_AREA_DATA.length - 1].volume;
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-between mb-2", children: [
          /* @__PURE__ */ jsxs2("div", { children: [
            /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx2("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Mono Curved Wave" }),
              /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Soft Gradient" }),
              // Daily Plate: what the chart shows, on hover or focus, beside its badge.
              info ? /* @__PURE__ */ jsx2(InfoTip, { text: info }) : null
            ] }),
            /* @__PURE__ */ jsxs2("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
              latestVal,
              "% ",
              ]), /* @__PURE__ */ jsx2("span", { className: "text-xs font-normal opacity-70", children: unit ?? "peak throughput" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs2("div", { className: `relative w-full flex-1 overflow-hidden p-2 transition-colors duration-300 touch-pan-y ${"dp-well"}`, children: [
          /* @__PURE__ */ jsx2("svg", { className: "absolute w-0 h-0 pointer-events-none", children: /* @__PURE__ */ jsx2("defs", { children: /* @__PURE__ */ jsxs2("linearGradient", { id: `${idPrefix}mono-area-gradient`, x1: "0", y1: "0", x2: "0", y2: "1", children: [
            /* @__PURE__ */ jsx2("stop", { offset: "0%", stopColor: "var(--ink)", stopOpacity: "0.18" }),
            /* @__PURE__ */ jsx2("stop", { offset: "100%", stopColor: "var(--ink)", stopOpacity: "0.0" })
          ] }) }) }),
          /* @__PURE__ */ jsx2(ResponsiveContainer, { width: "100%", height: compact ? 130 : 160, children: /* @__PURE__ */ jsxs2(AreaChart, { data: MONO_AREA_DATA, margin: { top: 12, right: 12, left: -22, bottom: 0 }, children: [
            /* @__PURE__ */ jsx2(
              CartesianGrid,
              {
                strokeDasharray: "2 2",
                vertical: false,
                stroke: "var(--hairline)"
              }
            ),
            /* @__PURE__ */ jsx2(XAxis, { dataKey: "time", tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--muted)" } }),
            /* @__PURE__ */ jsx2(YAxis, { tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--muted)" } }),
            /* @__PURE__ */ jsx2(Tooltip, { content: /* @__PURE__ */ jsx2(DitherChartTooltipContent, { theme, indicator: "dot" }) }),
            /* @__PURE__ */ jsx2(
              Area,
              {
                type: curve,
                dataKey: "volume",
                name: names?.[0] ?? "Volume Flow",
                stroke: "var(--ink)",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                fill: `url(#${idPrefix}mono-area-gradient)`,
                isAnimationActive: !isMobile && !REDUCED,
                animationDuration: isMobile ? 0 : 900
              }
            )
          ] }) })
        ] }),
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx2("span", { className: "dp-muted", children: footL ?? "Minimalist Spline Shading" }),
          /* @__PURE__ */ jsx2("span", { className: "dp-ink font-medium", children: footR ?? "99.9% Linear Flow" })
        ] })
      ]
    }
  );
}

export default MonoRoundedAreaChart;
