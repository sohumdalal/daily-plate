// Mova mono-activity-green, from @mova-ui/react 0.4.6 (MIT, see LICENSE.mova).
// Re-skinned for Daily Plate: colour, radius and type are the theme tokens,
// and the demo data is a prop with Mova's values as the fallback.
// Mova catalog component. See LICENSE.mova and LICENSE.third-party.
// src/components/mono-charts/MonoActivityHeatmap.tsx
import { useState, useMemo } from "react";
import { motion } from "framer-motion";

// src/utils/cn.ts
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// src/components/mono-charts/MonoActivityHeatmap.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
function generateDemoContributions(weeks) {
  const today = /* @__PURE__ */ new Date();
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (weeks * 7 - 1 - i));
    const rand = Math.random();
    let level = 0;
    let count = 0;
    if (rand > 0.35) {
      level = Math.floor(Math.random() * 4 + 1);
      count = level * 3 + Math.floor(Math.random() * 4);
    }
    return {
      date: date.toISOString().slice(0, 10),
      count,
      level
    };
  });
}
function toWeeks(contributions) {
  const weeks = [];
  for (let i = 0; i < contributions.length; i += 7) {
    weeks.push(contributions.slice(i, i + 7));
  }
  return weeks;
}
function MonoActivityHeatmap({ theme = "dark", accentColor = "mono", compact = false, data, title, badge, value, unit, footL, footR, names, highlight, tip, center, months, noun, hint }) {
  const isDark = theme === "dark";
  const [hoveredDay, setHoveredDay] = useState(null);
  const demoData = useMemo(() => data ?? generateDemoContributions(20), [data]);
  const weeks = useMemo(() => toWeeks(demoData), [demoData]);
  const totalContributions = useMemo(
    () => demoData.reduce((sum, d) => sum + d.count, 0),
    [demoData]
  );
  // Daily Plate: the theme's ink only; Mova's green, blue and purple are gone.
  const colorScale = { bg: "var(--ink)", badgeClass: "dp-badge", badgeText: "Monochrome Heat" };
  const opacityForLevel = (lvl) => {
    switch (lvl) {
      case 0:
        return isDark ? 0.06 : 0.08;
      case 1:
        return 0.3;
      case 2:
        return 0.55;
      case 3:
        return 0.8;
      case 4:
        return 1;
    }
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: cn(
        "relative w-full transition-all duration-300 group flex flex-col justify-between overflow-hidden p-4 sm:p-5 font-sans",
        compact ? "h-[220px] sm:h-[268px]" : "min-h-[290px]",
        "dp-card"
      ),
      children: [
        /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between mb-2", children: /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: `text-xs font-semibold tracking-wider uppercase ${"dp-muted"}`, children: title ?? "Activity Heatmap" }),
            /* @__PURE__ */ jsx("span", { className: cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] border", colorScale.badgeClass), children: badge ?? colorScale.badgeText })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "text-xl font-bold tracking-tight tabular-nums mt-0.5 font-sans", children: [...(value != null ? [value, " "] : [
            totalContributions,
            " ",
            ]), /* @__PURE__ */ jsx("span", { className: "text-xs font-normal opacity-70", children: unit ?? "contributions" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsxs("div", { className: cn(
          "relative w-full flex-1 overflow-hidden p-3 transition-colors duration-300 flex flex-col justify-center items-center",
          "dp-well"
        ), children: [
          /* @__PURE__ */ jsx("div", { className: "flex items-end mb-1 w-full gap-[3px]", children: (months ?? MONTH_NAMES.slice(0, 5)).map((m, idx) => /* @__PURE__ */ jsx("span", { className: `text-[10px] flex-1 min-w-0 whitespace-nowrap overflow-visible ${"dp-muted"}`, children: m }, idx)) }),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: "flex w-full gap-[3px] py-1",
              onPointerLeave: () => setHoveredDay(null),
              children: weeks.map((week, wIdx) => /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-[3px] flex-1 min-w-0", children: week.map((day, dIdx) => /* @__PURE__ */ jsx(
                motion.div,
                {
                  onPointerEnter: () => setHoveredDay(day),
                  onPointerDown: () => setHoveredDay(day),
                  className: "w-full aspect-square transition-all cursor-pointer",
                  style: {
                    backgroundColor: day.today ? "var(--primary)" : colorScale.bg,
                    opacity: day.today ? 1 : day.out ? 0.025 : opacityForLevel(day.level)
                  },
                  whileHover: { scale: 1.35, zIndex: 10 }
                },
                `${wIdx}-${dIdx}`
              )) }, wIdx))
            }
          ),
          /* @__PURE__ */ jsx("div", { className: "h-5 mt-2 flex items-center justify-center", children: hoveredDay ? /* @__PURE__ */ jsxs("span", { className: `text-[10px] ${"dp-muted"}`, children: [
            hoveredDay.count,
            " ",
            hoveredDay.count === 1 ? (noun?.[0] ?? "item") : (noun?.[1] ?? "items"),
            " on ",
            hoveredDay.date
          ] }) : /* @__PURE__ */ jsx("span", { className: `text-[10px] ${"dp-muted"}`, children: hint ?? "Hover tiles for metrics" }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mt-3 pt-1 border-t dp-rule text-[11px]", children: [
          /* @__PURE__ */ jsx("span", { className: "dp-muted", children: footL ?? "20 Weeks x 7 Days Grid" }),
          /* @__PURE__ */ jsx("span", { className: "dp-ink font-medium", children: footR ?? "Team Activity" })
        ] })
      ]
    }
  );
}

export default MonoActivityHeatmap;
