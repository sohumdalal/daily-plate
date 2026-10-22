// Mova mono-rounded-sparkline, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedSparklineChart.tsx
import { ResponsiveContainer, LineChart, Line } from "recharts";

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

// src/components/mono-charts/MonoRoundedSparklineChart.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var SPARK_ROWS__DEMO = [
  {
    name: "CPU Temp",
    val: "42\xB0C",
    data: [{ x: 1, y: 10 }, { x: 2, y: 25 }, { x: 3, y: 18 }, { x: 4, y: 40 }, { x: 5, y: 30 }]
  },
  {
    name: "GPU Temp",
    val: "58\xB0C",
    data: [{ x: 1, y: 15 }, { x: 2, y: 30 }, { x: 3, y: 22 }, { x: 4, y: 55 }, { x: 5, y: 48 }]
  },
  {
    name: "Fan Speed",
    val: "1.2k RPM",
    data: [{ x: 1, y: 40 }, { x: 2, y: 35 }, { x: 3, y: 60 }, { x: 4, y: 50 }, { x: 5, y: 80 }]
  }
];
function MonoRoundedSparklineChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint }) {
  const SPARK_ROWS = data ?? SPARK_ROWS__DEMO;
  const isDark = theme === "dark";
  const isMobile = useIsMobile();
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Sparklines" }),
            /* @__PURE__ */ jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Telemetry" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
            "3 Rows ",
            ]), /* @__PURE__ */ jsx("span", { className: "text-xs font-normal opacity-70", children: unit ?? "active" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx("div", { className: `relative w-full flex-1 overflow-hidden p-3 transition-colors duration-300 flex flex-col justify-around gap-2 touch-pan-y ${"dp-well"}`, children: SPARK_ROWS.map((row, idx) => /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex flex-col w-28 shrink-0", children: [
            /* @__PURE__ */ jsx("span", { className: `text-[11px] font-medium ${"dp-muted"}`, children: row.name }),
            /* @__PURE__ */ jsx("span", { className: `text-[15px] font-semibold tabular-nums ${"dp-ink"}`, children: row.val })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "flex-1 min-w-0 h-10", children: /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsx(LineChart, { data: row.data, children: /* @__PURE__ */ jsx(
            Line,
            {
              type: "monotone",
              dataKey: "y",
              stroke: "var(--ink)",
              strokeWidth: 2,
              strokeLinecap: "round",
              dot: (p) => p.index === row.data.length - 1 && p.value != null ? jsx("circle", { cx: p.cx, cy: p.cy, r: 4, fill: "var(--primary)", stroke: "var(--surface-soft)", strokeWidth: 2 }, p.index) : jsx("g", {}, p.index),
              isAnimationActive: !isMobile,
              animationDuration: isMobile ? 0 : 800
            }
          ) }) }) }),
          jsx("span", { className: `w-24 shrink-0 text-right text-[11px] tabular-nums ${row.up ? "dp-ink font-semibold" : "dp-muted"}`, children: row.delta ?? "" }),
        ] }, idx)) }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx("span", { className: "dp-muted", children: footL ?? "Rounded Mini Splines" }),
          /* @__PURE__ */ jsx("span", { className: "dp-ink font-medium", children: footR ?? "Real-Time Telemetry" })
        ] })
      ]
    }
  );
}

export default MonoRoundedSparklineChart;
