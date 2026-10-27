// Mova mono-rounded-kpi, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedKpiCardChart.tsx
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { InfoTip } from "../ui/info-tip.jsx";
import { jsx, jsxs } from "react/jsx-runtime";
var KPI_LINE_DATA__DEMO = [
  { v: 30 },
  { v: 45 },
  { v: 35 },
  { v: 60 },
  { v: 50 },
  { v: 85 },
  { v: 75 },
  { v: 95 }
];
function MonoRoundedKpiCardChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint, info }) {
  const KPI_LINE_DATA = data ?? KPI_LINE_DATA__DEMO;
  const isDark = theme === "dark";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "KPI Stat Card" }),
            // Daily Plate: the badge says what the chart shows, on hover or focus.
              info ? /* @__PURE__ */ jsx(InfoTip, { text: info, children: /* @__PURE__ */ jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Metric" }) }) : /* @__PURE__ */ jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Metric" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "text-2xl font-extrabold tracking-tight tabular-nums mt-1 font-sans", children: [...(value != null ? [value, " "] : [
            "$48,920 ",
            ]), /* @__PURE__ */ jsx("span", { className: "text-xs font-normal dp-muted", children: unit ?? "+14.2%" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx("div", { className: `relative w-full flex-1 overflow-hidden p-2 transition-colors duration-300 flex flex-col justify-end ${"dp-well"}`, children: /* @__PURE__ */ jsx("div", { className: "w-full h-24", children: /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxs(AreaChart, { data: KPI_LINE_DATA, children: [
          /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsxs("linearGradient", { id: "kpiGrad", x1: "0", y1: "0", x2: "0", y2: "1", children: [
            /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "var(--ink)", stopOpacity: 0.3 }),
            /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "var(--ink)", stopOpacity: 0 })
          ] }) }),
          /* @__PURE__ */ jsx(
            Area,
            {
              type: "monotone",
              dataKey: "v",
              stroke: "var(--ink)",
              strokeWidth: 2,
              strokeLinecap: "round",
              fill: "url(#kpiGrad)",
              animationDuration: 800
            }
          )
        ] }) }) }) }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx("span", { className: "dp-muted", children: footL ?? "Rounded Sparkline Wave" }),
          /* @__PURE__ */ jsx("span", { className: "dp-ink font-medium", children: footR ?? "Monthly Revenue" })
        ] })
      ]
    }
  );
}

export default MonoRoundedKpiCardChart;
