// quiz/quizExport.js — a quiz as files other tools import (Figma AISH-040.2). Pure text builders + one .xlsx writer.
//   • Kahoot: .xlsx with Kahoot's import columns (Question, Answer 1–4, Time limit, Correct answer(s)); question ≤ 120 and
//     answers ≤ 75 characters, so longer text is cut at a word end and counted. Kahoot has no column for sources.
//   • Anki: the tab-separated text ankiExport.js already writes (front = question + answers, back = answer + source).
//   • Moodle: GIFT text, the source as general feedback.
// No library: the .xlsx is a zip of five small XML parts (buildZip, like docxExport.js).
import { ankiFile, toHtml } from '../ankiExport.js';

export const KAHOOT_Q_MAX = 120;
export const KAHOOT_A_MAX = 75;
export const KAHOOT_TIMES = [10, 20, 30, 60];

/** Cut at a word end so it fits `max` (with "…"). Returns [text, cut?]. Pure. */
export function fit(s, max) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return [s, false];
    let cut = s.lastIndexOf(' ', max - 1);
    if (cut < max * 0.6) cut = max - 1;
    return [s.slice(0, cut).replace(/[\s,;:.–-]+$/, '') + '…', true];
}

/** Rows for Kahoot (first row = headers) and how many texts had to be shortened. Pure. */
export function kahootRows(quiz, time = 20) {
    const t = KAHOOT_TIMES.includes(Number(time)) ? Number(time) : 20;
    let cut = 0;
    const rows = [['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Time limit', 'Correct answer(s)']];
    for (const q of quiz.questions) {
        const [qt, qc] = fit(q.q, KAHOOT_Q_MAX); if (qc) cut++;
        const answers = q.options.map(o => { const [a, c] = fit(o, KAHOOT_A_MAX); if (c) cut++; return a; });
        rows.push([qt, ...answers, t, q.correct + 1]);
    }
    return { rows, cut };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i) => String.fromCharCode(65 + i);

/** The parts of an .xlsx with one sheet: strings in sharedStrings, numbers as numbers. Pure. */
export function xlsxParts(rows, sheetName = 'Quiz') {
    const strings = [], index = new Map();
    const sid = (s) => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
    const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
        const ref = col(ci) + (ri + 1);
        return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sid(String(v))}</v></c>`;
    }).join('') + '</row>').join('');
    return [
        { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
        { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
        { name: 'xl/sharedStrings.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')}</sst>` },
    ];
}

/** → { blob, cut } for Kahoot's "Import from spreadsheet". */
export async function kahootXlsx(quiz, time) {
    const { buildZip } = await import('../markdownArchive.js');
    const { rows, cut } = kahootRows(quiz, time);
    const zip = await buildZip(xlsxParts(rows, 'Kahoot'));
    return { blob: new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), cut };
}

const srcLine = (quiz, s) => { const a = (quiz.articles || []).find(x => x.id === s.articleId); return `“${s.quote}”` + (a ? ` — ${a.title || a.url || ''}${s.para ? ` ¶ ${s.para}` : ''}` : ''); };

/** Anki text: front = question with the answers, back = the right answer and where it says so. Pure. */
export function ankiText(quiz) {
    const cards = quiz.questions.map(q => ({
        id: 'aishquiz_' + q.id,
        front: toHtml(q.q) + '<br><br>' + q.options.map((o, i) => `${'ABCD'[i]}) ${toHtml(o)}`).join('<br>'),
        back: `<b>${'ABCD'[q.correct]}) ${toHtml(q.options[q.correct])}</b><br><br><small>${q.sources.map(s => toHtml(srcLine(quiz, s))).join('<br>')}</small>`,
    }));
    return ankiFile({ deck: 'AI Summary Helper::' + (quiz.name || 'Quiz'), tags: ['quiz'], cards });
}

const gift = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[~=#{}:\\]/g, (c) => '\\' + c);

/** Moodle GIFT: one multiple-choice question per block, the source as general feedback. Pure. */
export function moodleGift(quiz) {
    const name = gift(quiz.name || 'Quiz');
    return `// ${String(quiz.name || 'Quiz').replace(/\n/g, ' ')} — AI Summary Helper\n$CATEGORY: $course$/${name}\n\n` + quiz.questions.map((q, i) =>
        `::${name} ${i + 1}::${gift(q.q)} {\n` + q.options.map((o, k) => `\t${k === q.correct ? '=' : '~'}${gift(o)}`).join('\n')
        + `\n\t####${gift(q.sources.map(s => srcLine(quiz, s)).join(' · '))}\n}\n`).join('\n');
}
