// Mova mono-rounded-heatmap, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoRoundedHeatmapChart.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var HEATMAP_DATA__DEMO = [
  { day: "Mon", hours: [10, 40, 80, 50, 90, 30, 60] },
  { day: "Tue", hours: [30, 60, 90, 70, 40, 80, 20] },
  { day: "Wed", hours: [50, 70, 30, 80, 60, 90, 40] },
  { day: "Thu", hours: [20, 80, 60, 40, 90, 50, 70] },
  { day: "Fri", hours: [60, 90, 70, 90, 50, 30, 80] }
];
function MonoRoundedHeatmapChart({ theme = "dark", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint }) {
  const HEATMAP_DATA = data ?? HEATMAP_DATA__DEMO;
  const isDark = theme === "dark";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 ${compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]"} ${"dp-card"}`,
      children: [
        /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Matrix Heatmap" }),
            /* @__PURE__ */ jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] dp-badge", children: badge ?? "Activity" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
            "35 Nodes ",
            ]), /* @__PURE__ */ jsx("span", { className: "text-xs font-normal opacity-70", children: unit ?? "mapped" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx("div", { className: `relative w-full flex-1 overflow-hidden p-3 transition-colors duration-300 flex flex-col justify-center gap-1.5 ${"dp-well"}`, children: HEATMAP_DATA.map((row, rIdx) => /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-2 max-w-[280px] mx-auto w-full", children: [
          /* @__PURE__ */ jsx("span", { className: `text-[10px] w-7 shrink-0 ${"dp-muted"}`, children: row.day }),
          /* @__PURE__ */ jsx("div", { className: "flex-1 flex items-center justify-between gap-1.5", children: row.hours.map((val, cIdx) => {
            const opacity = val / 100;
            return /* @__PURE__ */ jsx(
              "div",
              {
                title: tip ? tip(row, cIdx, val) : `Activity: ${val}%`,
                className: "aspect-square flex-1 transition-all hover:scale-110 cursor-pointer",
                style: {
                  backgroundColor: `rgba(var(--ink-rgb),${opacity})`
                }
              },
              cIdx
            );
          }) })
        ] }, rIdx)) }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx("span", { className: "dp-muted", children: footL ?? "Rounded Node Cells" }),
          /* @__PURE__ */ jsx("span", { className: "dp-ink font-medium", children: footR ?? "7x5 Density Grid" })
        ] })
      ]
    }
  );
}

export default MonoRoundedHeatmapChart;
