// Summary languages. `code` is what is stored (selectedLanguage); `english` is what the model is told.
export const LANGUAGES = [
  { code: "en", name: "English", emoji: "🌍", english: "English" },
  { code: "cn", name: "简体中文", emoji: "🇨🇳", english: "Simplified Chinese (\u7b80\u4f53\u4e2d\u6587)" },
  { code: "tw", name: "繁體中文", emoji: "🇹🇼", english: "Traditional Chinese (繁體中文, Taiwan)" },
  { code: "es", name: "Español", emoji: "🇪🇸", english: "Spanish" },
  { code: "hi", name: "हिंदी", emoji: "🇮🇳", english: "Hindi" },
  { code: "ar", name: "العربية", emoji: "🇦🇪", english: "Arabic" },
  { code: "ind-bahasa", name: "Bahasa Indonesia", emoji: "🇮🇩", english: "Indonesian" },
  { code: "da", name: "Dansk", emoji: "🇩🇰", english: "Danish" },
  { code: "de", name: "Deutsch", emoji: "🇩🇪", english: "German" },
  { code: "tl", name: "Filipino", emoji: "🇵🇭", english: "Filipino (Tagalog)" },
  { code: "fr", name: "Français", emoji: "🇫🇷", english: "French" },
  { code: "it", name: "Italiano", emoji: "🇮🇹", english: "Italian" },
  { code: "sw", name: "Kiswahili", emoji: "🇰🇪", english: "Swahili" },
  { code: "nl", name: "Nederlands", emoji: "🇳🇱", english: "Dutch" },
  { code: "pl", name: "Polski", emoji: "🇵🇱", english: "Polish" },
  { code: "pt", name: "Português", emoji: "🇵🇹", english: "Portuguese" },
  { code: "ro", name: "Română", emoji: "🇷🇴", english: "Romanian" },
  { code: "sv", name: "Svenska", emoji: "🇸🇪", english: "Swedish" },
  { code: "vi", name: "Tiếng Việt", emoji: "🇻🇳", english: "Vietnamese" },
  { code: "tr", name: "Türkçe", emoji: "🇹🇷", english: "Turkish" },
  { code: "bg", name: "Български", emoji: "🇧🇬", english: "Bulgarian" },
  { code: "ru", name: "Русский", emoji: "🇷🇺", english: "Russian" },
  { code: "ua", name: "Українська", emoji: "🇺🇦", english: "Ukrainian" },
  { code: "ur", name: "اردو", emoji: "🇵🇰", english: "Urdu" },
  { code: "fa", name: "فارسی", emoji: "🇮🇷", english: "Persian (Farsi)" },
  { code: "bn", name: "বাংলা", emoji: "🇧🇩", english: "Bengali" },
  { code: "th", name: "ไทย", emoji: "🇹🇭", english: "Thai" },
  { code: "jp", name: "日本語", emoji: "🇯🇵", english: "Japanese" },
  { code: "kr", name: "한국어", emoji: "🇰🇷", english: "Korean" }
];

/** English language name for a stored code (falls back to the code itself, e.g. 'en-US'). */
export function languageEnglishName(code) {
    const l = LANGUAGES.find(x => x.code === code);
    return l ? l.english : (code || 'English');
}
