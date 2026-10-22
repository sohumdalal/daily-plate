// Mova mono-rounded-donut, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedDonutChart.tsx
import { REDUCED } from "../reduced.js";
import { useState as useState2 } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

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

// src/components/mono-charts/MonoRoundedDonutChart.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var MONO_DONUT_DATA__DEMO = [
  { name: "Core Engine", value: 45, shade: "#FFFFFF" },
  { name: "UI Layer", value: 30, shade: "#CBD5E1" },
  { name: "Assets", value: 15, shade: "#94A3B8" },
  { name: "Other", value: 10, shade: "#64748B" }
];
const fillOf = (index) => index === 0 ? "var(--ink)" : `rgba(var(--ink-rgb),${[0.65, 0.4, 0.2][index - 1] ?? 0.12})`;
function MonoRoundedDonutChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint }) {
  const MONO_DONUT_DATA = data ?? MONO_DONUT_DATA__DEMO;
  // Daily Plate: the centre shows the largest share until a segment is hovered,
  // and each legend dot wears its segment's tone.
  const top = MONO_DONUT_DATA.reduce((a, d, i) => (d.value > MONO_DONUT_DATA[a].value ? i : a), 0);
  const isDark = theme === "dark";
  const isMobile = useIsMobile();
  const [hoverIndex, setHoverIndex] = useState2(null);
  const total = MONO_DONUT_DATA.reduce((acc, item) => acc + item.value, 0);
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsx2("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx2("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Mono Rounded Donut" }),
            /* @__PURE__ */ jsx2("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Soft Arc Caps" })
          ] }),
          /* @__PURE__ */ jsxs2("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
            total,
            "% ",
            ]), /* @__PURE__ */ jsx2("span", { className: "text-xs font-normal opacity-70", children: unit ?? "allocation" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsxs2("div", { className: `relative w-full flex-1 overflow-hidden p-2 transition-colors duration-300 flex items-center justify-center touch-pan-y ${"dp-well"}`, children: [
          /* @__PURE__ */ jsx2(ResponsiveContainer, { width: "100%", height: compact ? 130 : 160, children: /* @__PURE__ */ jsxs2(PieChart, { children: [
            /* @__PURE__ */ jsx2(Tooltip, { content: /* @__PURE__ */ jsx2(DitherChartTooltipContent, { theme, indicator: "dot" }) }),
            /* @__PURE__ */ jsx2(
              Pie,
              {
                data: MONO_DONUT_DATA,
                dataKey: "value",
                nameKey: "name",
                cx: "50%",
                cy: "50%",
                innerRadius: compact ? 38 : 46,
                outerRadius: compact ? 58 : 68,
                paddingAngle: 2,
                cornerRadius: 0,
                strokeLinecap: "round",
                onMouseEnter: (_, idx) => setHoverIndex(idx),
                onMouseLeave: () => setHoverIndex(null),
                isAnimationActive: !isMobile && !REDUCED,
                animationDuration: isMobile ? 0 : 900,
                children: MONO_DONUT_DATA.map((entry, index) => {
                  const isHovered = hoverIndex === index;
                  const fillColor = fillOf(index);
                  return /* @__PURE__ */ jsx2(
                    Cell,
                    {
                      fill: fillColor,
                      stroke: "var(--canvas)",
                      strokeWidth: 2,
                      style: {
                        transform: isHovered ? "scale(1.05)" : "scale(1)",
                        transformOrigin: "center center",
                        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        cursor: "pointer"
                      }
                    },
                    `mono-cell-${index}`
                  );
                })
              }
            )
          ] }) }),
          /* @__PURE__ */ jsxs2("div", { className: "absolute inset-0 flex flex-col items-center justify-center pointer-events-none", children: [
            /* @__PURE__ */ jsx2("span", { className: "text-sm font-bold tabular-nums font-sans", children: `${MONO_DONUT_DATA[hoverIndex ?? top].value}%` }),
            /* @__PURE__ */ jsx2("span", { className: `text-[10px] ${"dp-muted"}`, children: hoverIndex !== null ? MONO_DONUT_DATA[hoverIndex].name : MONO_DONUT_DATA[top].name ?? center })
          ] })
        ] }),
        /* @__PURE__ */ jsx2("div", { className: "flex items-center justify-around mt-3 pt-1 border-t dp-rule text-[10px]", children: MONO_DONUT_DATA.map((seg, idx) => /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-1", children: [
          /* @__PURE__ */ jsx2("span", { className: "w-1.5 h-1.5 rounded-full", style: { background: fillOf(idx) } }),
          /* @__PURE__ */ jsx2("span", { className: "dp-muted", children: seg.name })
        ] }, idx)) })
      ]
    }
  );
}

export default MonoRoundedDonutChart;
