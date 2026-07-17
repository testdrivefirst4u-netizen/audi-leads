// Validated 8-slot categorical palette (see the dataviz skill) — fixed hue
// order, never cycled. Lead status already has its own fixed mapping
// (lib/leadFields.js's statusChartColor, since the status set is small and
// known). This is for report breakdowns where the label set is data-driven
// (model/showroom/source) — colors are assigned by rank, first-seen-first,
// so a report's own top categories keep a stable hue across re-renders as
// long as the underlying order doesn't change.
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
];

// "Other" is a fold-the-tail bucket, not a real category — kept a neutral
// gray, outside the categorical rotation, so it never impersonates a series.
export const OTHER_COLOR = "#94a3b8";

export function categoricalColor(index, label) {
  if (label === "Other") return OTHER_COLOR;
  return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
}

// Folds a breakdown down to its top N labels + an "Other" bucket, applied
// once by the caller so a paired bar+pie chart (Reports page) always show
// the exact same categories in the exact same order — otherwise each
// chart's own internal top-N cutoff could disagree and the colors would no
// longer line up between them.
export function consolidateTopN(data, n) {
  if (!data || data.length <= n) return data || [];
  const top = data.slice(0, n);
  const rest = data.slice(n).reduce((sum, r) => sum + r.count, 0);
  const restPercentage = data.slice(n).reduce((sum, r) => sum + (r.percentage || 0), 0);
  return [...top, { label: "Other", count: rest, percentage: Math.round(restPercentage * 10) / 10 }];
}
