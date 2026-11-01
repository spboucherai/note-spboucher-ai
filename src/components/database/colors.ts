import type { OptionColor } from "@/lib/databases/types";
export const OPTION_CLASS: Record<OptionColor, string> = {
  gray: "bg-bg-sunk text-fg-muted", blue: "bg-blue-500/15 text-blue-800 dark:text-blue-200", green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200", yellow: "bg-yellow-400/25 text-yellow-800 dark:text-yellow-200",
  orange: "bg-orange-500/15 text-orange-800 dark:text-orange-200", red: "bg-red-500/15 text-red-800 dark:text-red-200", purple: "bg-purple-500/15 text-purple-800 dark:text-purple-200", pink: "bg-pink-500/15 text-pink-800 dark:text-pink-200", teal: "bg-teal-500/15 text-teal-800 dark:text-teal-200",
};
export const DOT_CLASS: Record<OptionColor, string> = { gray: "bg-fg-faint", blue: "bg-blue-500", green: "bg-emerald-500", yellow: "bg-yellow-400", orange: "bg-orange-500", red: "bg-red-500", purple: "bg-purple-500", pink: "bg-pink-500", teal: "bg-teal-500" };
