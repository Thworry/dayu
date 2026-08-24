import type { ScoringCaveat } from "@dayu/scoring-core";

import { en } from "./messages/en.js";
import { zh } from "./messages/zh.js";

export { en, zh };

export type Locale = "en" | "zh";
export type MessageKey = keyof typeof zh;
export type MessageParams = Readonly<Record<string, number | string>>;

const messages: Record<Locale, Record<MessageKey, string>> = { en, zh };

export function t(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return messages[locale][key].replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function findingMessage(
  locale: Locale,
  key: string,
  fallback: "cautionExplanation" | "cautionTitle" | "positiveExplanation" | "positiveTitle",
): string {
  if (Object.prototype.hasOwnProperty.call(messages[locale], key)) {
    return messages[locale][key as MessageKey];
  }
  const fallbackKeys = {
    cautionExplanation: "finding.generic.caution.explanation",
    cautionTitle: "finding.generic.caution.title",
    positiveExplanation: "finding.generic.positive.explanation",
    positiveTitle: "finding.generic.positive.title",
  } as const satisfies Record<typeof fallback, MessageKey>;
  return t(locale, fallbackKeys[fallback]);
}

const caveatKeys = {
  active_weeks_unavailable: "report.caveat.active_weeks_unavailable",
  binary_lfs: "report.caveat.binary_lfs",
  bounded_activity_sample: "report.caveat.bounded_activity_sample",
  external_tracker: "report.caveat.external_tracker",
  generated_heavy: "report.caveat.generated_heavy",
  low_star_wording_guard: "report.caveat.low_star_wording_guard",
  monorepo: "report.caveat.monorepo",
  new_repo_history_guard: "report.caveat.new_repo_history_guard",
} as const satisfies Record<ScoringCaveat, MessageKey>;

function isScoringCaveat(value: string): value is ScoringCaveat {
  return Object.prototype.hasOwnProperty.call(caveatKeys, value);
}

export function caveatMessage(locale: Locale, value: string): string {
  const keys = value.split(",").map((part) => part.trim()).filter((part) => part !== "");
  const localized = keys.map((key) => t(locale, isScoringCaveat(key) ? caveatKeys[key] : "report.caveat.unknown"));
  return [...new Set(localized)].join(locale === "zh" ? "；" : " ");
}
