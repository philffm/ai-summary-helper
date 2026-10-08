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
  { code: "kr", name: "한국어", emoji: "🇰🇷", english: "Korean" },
  { code: "el", name: "Ελληνικά", emoji: "🇬🇷", english: "Greek" },
  { code: "cs", name: "Čeština", emoji: "🇨🇿", english: "Czech" },
  { code: "hu", name: "Magyar", emoji: "🇭🇺", english: "Hungarian" },
  { code: "fi", name: "Suomi", emoji: "🇫🇮", english: "Finnish" },
  { code: "no", name: "Norsk", emoji: "🇳🇴", english: "Norwegian" },
  { code: "he", name: "עברית", emoji: "🇮🇱", english: "Hebrew" },
  { code: "ms", name: "Bahasa Melayu", emoji: "🇲🇾", english: "Malay" },
  { code: "ta", name: "தமிழ்", emoji: "🇮🇳", english: "Tamil" },
  { code: "te", name: "తెలుగు", emoji: "🇮🇳", english: "Telugu" },
  { code: "mr", name: "मराठी", emoji: "🇮🇳", english: "Marathi" },
  { code: "ca", name: "Català", emoji: "🇪🇸", english: "Catalan" },
  { code: "hr", name: "Hrvatski", emoji: "🇭🇷", english: "Croatian" }
];

/** English language name for a stored code (falls back to the code itself, e.g. 'en-US'). */
export function languageEnglishName(code) {
    const l = LANGUAGES.find(x => x.code === code);
    return l ? l.english : (code || 'English');
}

// The same instruction written IN the target language: small local models (gemma, llama…) obey a sentence in the
// language they should answer in far more reliably than an English "answer in German" buried in English text.
const NATIVE_RULE = {
  de: 'Antworte ausschließlich auf Deutsch.', fr: 'Réponds uniquement en français.', es: 'Responde únicamente en español.',
  it: 'Rispondi esclusivamente in italiano.', pt: 'Responde exclusivamente em português.', nl: 'Antwoord uitsluitend in het Nederlands.',
  pl: 'Odpowiadaj wyłącznie po polsku.', ru: 'Отвечай только на русском языке.', ua: 'Відповідай лише українською мовою.',
  jp: '必ず日本語だけで答えてください。', kr: '반드시 한국어로만 답변하세요.', cn: '请只用简体中文回答。', tw: '請只用繁體中文回答。',
  ar: 'أجب باللغة العربية فقط.', hi: 'केवल हिंदी में उत्तर दें।', tr: 'Yalnızca Türkçe yanıt ver.', sv: 'Svara endast på svenska.',
  da: 'Svar kun på dansk.', no: 'Svar kun på norsk.', fi: 'Vastaa vain suomeksi.', cs: 'Odpovídej pouze česky.',
  el: 'Απάντησε μόνο στα ελληνικά.', hu: 'Kizárólag magyarul válaszolj.', ro: 'Răspunde exclusiv în limba română.',
  vi: 'Chỉ trả lời bằng tiếng Việt.', th: 'ตอบเป็นภาษาไทยเท่านั้น', he: 'ענה בעברית בלבד.', 'ind-bahasa': 'Jawab hanya dalam bahasa Indonesia.',
  ms: 'Jawab dalam bahasa Melayu sahaja.', bg: 'Отговаряй само на български.', hr: 'Odgovaraj samo na hrvatskom.', ca: 'Respon només en català.'
};

/**
 * Hard language instruction for summary prompts ('' for English). Says it three ways: the language name, an explicit
 * "not English" rule (page text, instructions and the model's own reasoning are English), and a native-language sentence.
 */
export function languageRule(code) {
  if (!code || code === 'en' || /^en(-|_|$)/i.test(code) || code === 'English') return '';
  const name = languageEnglishName(code);
  if (name === code && !NATIVE_RULE[code]) return '';
  return `LANGUAGE RULE (mandatory): write the entire output — every heading, paragraph and sentence — in ${name}. `
    + `Do NOT write it in English, even though the page text and these instructions are in English; only direct quotes keep their original language. `
    + (NATIVE_RULE[code] || '');
}

const ALIASES = {
  "en": "english anglais inglese ingles englisch",
  "cn": "chinese mandarin china zhongwen putonghua simplified zh",
  "tw": "chinese traditional taiwan hanzi zhongwen zh-tw hong kong cantonese zh-hk",
  "es": "spanish castellano espanol",
  "hi": "hindi india",
  "ar": "arabic arab",
  "ind-bahasa": "indonesian indonesia bahasa",
  "da": "danish denmark",
  "de": "german deutsch germany allemand alemán aleman",
  "tl": "filipino tagalog philippines pilipino",
  "fr": "french francais france",
  "it": "italian italiano italy",
  "sw": "swahili kiswahili kenya tanzania",
  "nl": "dutch nederlands netherlands holland flemish",
  "pl": "polish polski poland",
  "pt": "portuguese portugues brazil brazilian portugal brasil",
  "ro": "romanian romania",
  "sv": "swedish svenska sweden",
  "vi": "vietnamese vietnam",
  "tr": "turkish turkce turkey",
  "bg": "bulgarian bulgaria",
  "ru": "russian russia russkiy",
  "ua": "ukrainian ukraine uk",
  "ur": "urdu pakistan",
  "fa": "persian farsi iran",
  "bn": "bengali bangla bangladesh",
  "th": "thai thailand",
  "jp": "japanese japan nihongo ja",
  "kr": "korean korea hangul hangeul hanguk ko",
  "el": "greece hellenic",
  "cs": "czechia bohemian cesky",
  "hu": "hungary",
  "fi": "finland",
  "no": "norway bokmal nynorsk",
  "he": "israel ivrit",
  "ms": "malaysia melayu",
  "ta": "india sri lanka",
  "te": "india",
  "mr": "india",
  "ca": "catalunya catalonia",
  "hr": "croatia"
};

const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** One lower-cased, accent-folded string to search in: native name, English name, code and synonyms. */
export function languageSearchText(code) {
    const l = LANGUAGES.find(x => x.code === code);
    if (!l) return fold(code);
    return fold([l.name, l.english, l.code, ALIASES[l.code] || ''].join(' '));
}

/** Does the typed text match this language? Every typed word must appear (prefix or substring) in the search text. */
export function languageMatches(code, query) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = languageSearchText(code);
    return words.every(w => hay.includes(w));
}
