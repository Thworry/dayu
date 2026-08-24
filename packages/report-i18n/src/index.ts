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
