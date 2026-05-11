import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en/translation.json';
import fr from './locales/fr/translation.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Broadcast every language change to plugins. Plugin bundles can't share our
// react-i18next instance (they live in a separate import graph), so they
// subscribe to this DOM event via @oscarr/sdk's `useLanguage()` hook.
function syncLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', lng);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('oscarr:lang-changed', { detail: lng }));
  }
}

i18n.on('languageChanged', syncLang);
// Also fire once on init so the <html lang> reflects the detected language
// before any plugin mounts and reads it.
if (i18n.language) syncLang(i18n.language);

export default i18n;
