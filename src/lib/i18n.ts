import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";
import { deviceLocale } from "./deviceLocale";

function getStoredLocale(): string {
  try {
    const data = JSON.parse(localStorage.getItem("gardener-storage") ?? "{}");
    return data?.state?.locale ?? deviceLocale();
  } catch {
    return deviceLocale();
  }
}

// Plurals: i18next (v21+) resolves key_one/key_other via Intl.PluralRules
// (es/fr also need key_many). Pass the count option; see docs/DESIGN_SYSTEM.md.
i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: getStoredLocale(),
    fallbackLng: "en",
    supportedLngs: ["en", "de", "es", "fr"],
    backend: {
      // The build id keeps browser caches from serving the previous release's texts.
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json?v=${__BUILD_ID__}`,
    },
    interpolation: {
      escapeValue: false,
    },
  });

// Screen readers and browser translation rely on this matching the UI language.
function syncDocumentLanguage(lng: string) {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
syncDocumentLanguage(i18n.language ?? getStoredLocale());
i18n.on("languageChanged", syncDocumentLanguage);

/**
 * After an update the new service worker takes over while the page runs on.
 * Pages loaded lazily from then on are the new ones, but the texts in memory
 * are still the old ones, so new keys would show raw. Reload the texts when
 * the worker changes (not on its very first install, where nothing changed).
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    void i18n.reloadResources().then(() => i18n.changeLanguage(i18n.language));
  });
}

export default i18n;
