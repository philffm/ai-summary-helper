// dayLine.js — the line under "Good morning" on the home page: one sentence that sends the reader into the day.
// Where it comes from, in the order it is shown: today's recap (an AI-written thought or a historical fact for this date; only when the user turned
// "Daily quote with the RSS recap" on), a line the user saved themselves (one day in four), then a fixed collection of quotes (English and German).
// The date picks the line (the same all day); "New line" steps to the next one. Pure functions, no storage.

/** [text, who]. Only lines that can be traced to a source (a work or a named author); no "motivational" sayings of unknown origin. */
export const QUOTES = {
    en: [
        ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca, On the Shortness of Life'],
        ['To be everywhere is to be nowhere.', 'Seneca, Letters to Lucilius'],
        ['Some books are to be tasted, others to be swallowed, and some few to be chewed and digested.', 'Francis Bacon, Of Studies'],
        ['Knowing is not enough; we must apply. Willing is not enough; we must do.', 'Goethe'],
        ['What stands in the way becomes the way.', 'after Marcus Aurelius, Meditations'],
        ['He who has a why to live can bear almost any how.', 'Nietzsche, Twilight of the Idols'],
        ['The journey of a thousand miles begins with a single step.', 'Laozi, Tao Te Ching'],
        ['The beginning is the most important part of the work.', 'Plato, The Republic'],
        ['The mind is not a vessel to be filled, but a fire to be kindled.', 'after Plutarch, On Listening'],
        ['Read much, but not many books.', 'Pliny the Younger, Letters'],
        ['Attention is the rarest and purest form of generosity.', 'Simone Weil'],
        ['Reading is to the mind what exercise is to the body.', 'Joseph Addison, The Tatler'],
        ['Drink deep, or taste not the Pierian spring.', 'Alexander Pope, An Essay on Criticism'],
        ['Life is short, the art long.', 'Hippocrates'],
        ['The unexamined life is not worth living.', 'Socrates, in Plato’s Apology'],
        ['Dare to use your own understanding.', 'Kant, What is Enlightenment?'],
        ['Time you enjoy wasting is not wasted time.', 'Marthe Troly-Curtin'],
        ['Fall seven times, stand up eight.', 'Japanese proverb'],
    ],
    de: [
        ['Es ist nicht wenig Zeit, die wir haben, sondern viel, die wir nicht nutzen.', 'Seneca, Von der Kürze des Lebens'],
        ['Wer überall ist, ist nirgends.', 'Seneca, Briefe an Lucilius'],
        ['Manche Bücher soll man nur schmecken, andere verschlingen, und einige wenige kauen und verdauen.', 'Francis Bacon, Über das Studium'],
        ['Es ist nicht genug zu wissen, man muss auch anwenden; es ist nicht genug zu wollen, man muss auch tun.', 'Goethe, Wilhelm Meisters Wanderjahre'],
        ['Man muss etwas Neues machen, um etwas Neues zu sehen.', 'Lichtenberg'],
        ['Wer ein Warum zu leben hat, erträgt fast jedes Wie.', 'Nietzsche, Götzen-Dämmerung'],
        ['Eine Reise von tausend Meilen beginnt mit dem ersten Schritt.', 'Laozi, Tao Te King'],
        ['Der Anfang ist die Hauptsache bei jedem Werk.', 'Platon, Der Staat'],
        ['Der Geist ist kein Gefäß, das gefüllt, sondern ein Feuer, das entzündet werden will.', 'nach Plutarch'],
        ['Viel lesen, nicht vielerlei.', 'Plinius der Jüngere, Briefe'],
        ['Aufmerksamkeit ist die seltenste und reinste Form der Großzügigkeit.', 'Simone Weil'],
        ['Lesen ist für den Geist, was Bewegung für den Körper ist.', 'Joseph Addison'],
        ['Das Leben ist kurz, die Kunst ist lang.', 'Hippokrates'],
        ['Ein Leben ohne Selbstprüfung ist nicht lebenswert.', 'Sokrates, in Platons Apologie'],
        ['Habe Mut, dich deines eigenen Verstandes zu bedienen!', 'Kant, Was ist Aufklärung?'],
        ['Was man nicht nützt, ist eine schwere Last.', 'Goethe, Faust'],
        ['Jedem Anfang wohnt ein Zauber inne.', 'Hermann Hesse, Stufen'],
        ['Zeit, die man gern vertut, ist keine verlorene Zeit.', 'Marthe Troly-Curtin'],
    ],
};

export const dayOfYear = (d) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
/** The language of the collection for a UI language code ("de", "de-AT" → German; anything else English). */
export const collectionLang = (code) => (/^de\b/i.test(String(code || '')) ? 'de' : 'en');
/** A small seeded generator, so "the line a user saved" is the same one all day. */
export function seeded(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * The lines for today, in the order they are offered.
 * @param {{ now?: Date, lang?: string, note?: string, own?: { text: string, by?: string } | null }} o
 *   note = today's recap note (only a recap written today counts, the caller checks), own = something the user saved.
 * @returns {{ kind: 'note' | 'own' | 'quote', text: string, by?: string }[]}  never empty
 */
export function dayLines({ now = new Date(), lang = 'en', note = '', own = null } = {}) {
    const q = QUOTES[collectionLang(lang)], doy = dayOfYear(now), n = q.length, out = [];
    const quote = (i) => { const [text, by] = q[((doy + i) % n + n) % n]; return { kind: 'quote', text, by }; };
    const ownLine = own && String(own.text || '').trim() ? { kind: 'own', text: String(own.text).trim().slice(0, 200), by: own.by || '' } : null;
    const ownDay = !!ownLine && doy % 4 === 3;   // one day in four
    if (note) out.push({ kind: 'note', text: String(note).trim() });
    if (ownDay) out.push(ownLine);
    for (let i = 0; i < 6; i++) out.push(quote(i));
    if (ownLine && !ownDay) out.push(ownLine);   // reachable with "New line"
    return out;
}

/** The line to show: `shift` steps on from today's first one ("New line"). */
export function pickDayLine(lines, shift = 0) {
    const n = lines.length; return lines[((shift % n) + n) % n];
}
