import type { Locale } from "@dayu/report-i18n";

export const locales = ["zh", "en"] as const satisfies readonly Locale[];

export function isLocale(value: string | undefined): value is Locale {
  return value === "zh" || value === "en";
}

export function preferredLocale(language = globalThis.navigator.language): Locale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function oppositeLocale(locale: Locale): Locale {
  return locale === "zh" ? "en" : "zh";
}
