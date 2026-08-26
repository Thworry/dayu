/* global document, URL, window */

const translations = document.querySelectorAll("[data-en][data-zh]");
const languageButtons = document.querySelectorAll("[data-language]");

function setLanguage(language) {
  const next = language === "zh" ? "zh" : "en";
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  for (const element of translations) {
    const value = element.dataset[next];
    if (value !== undefined) element.textContent = value;
  }
  for (const button of languageButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.language === next));
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", next);
  window.history.replaceState({}, "", url);
}

for (const button of languageButtons) {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
}

setLanguage(new URL(window.location.href).searchParams.get("lang") ?? "en");
