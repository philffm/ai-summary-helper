// docxExport.js — Markdown note → minimal Word document (.docx). No library: a .docx is a zip of three small XML parts,
// and buildZip (markdownArchive.js) already writes zips. Handles what our notes contain: headings, paragraphs, bullets,
// quotes, **bold**, *italic*, [text](url) (kept as "text (url)"), --- rules and ![image](src) (shown as text).
import { buildZip } from './markdownArchive.js';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Inline Markdown → runs. */
function runs(text, base = '') {
    const out = [];
    const t = String(text).replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '[$1]').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, u) => a === u ? a : `${a} (${u})`);
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let last = 0, m;
    const run = (s, rpr) => { if (s) out.push(`<w:r><w:rPr>${base}${rpr}</w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`); };
    while ((m = re.exec(t))) {
        run(t.slice(last, m.index), '');
        if (m[1] !== undefined) run(m[1], '<w:b/>'); else if (m[2] !== undefined) run(m[2], '<w:i/>'); else run(m[3], '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
        last = m.index + m[0].length;
    }
    run(t.slice(last), '');
    return out.join('');
}

const para = (text, { rpr = '', ppr = '' } = {}) => `<w:p><w:pPr>${ppr}</w:pPr>${runs(text, rpr)}</w:p>`;
const HEAD = { 1: 40, 2: 32, 3: 28, 4: 26 };   // half-points

/** Markdown (no front matter) → word/document.xml body paragraphs. */
export function markdownToParagraphs(md) {
    const ps = [];
    for (const line of String(md || '').split(/\r?\n/)) {
        const l = line.replace(/\s+$/, '');
        if (!l.trim()) continue;
        let m;
        if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
            const n = Math.min(4, m[1].length);
            ps.push(para(m[2], { rpr: `<w:b/><w:sz w:val="${HEAD[n]}"/>`, ppr: '<w:keepNext/><w:spacing w:before="240" w:after="80"/>' }));
        } else if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) ps.push(para('• ' + m[1], { ppr: '<w:ind w:left="360" w:hanging="220"/>' }));
        else if ((m = /^\s*\d+\.\s+(.*)$/.exec(l))) ps.push(para(l.trim(), { ppr: '<w:ind w:left="360" w:hanging="260"/>' }));
        else if ((m = /^>\s?(.*)$/.exec(l))) ps.push(para(m[1], { rpr: '<w:i/><w:color w:val="555555"/>', ppr: '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="AAAAAA"/></w:pBdr><w:ind w:left="360"/>' }));
        else if (/^-{3,}$/.test(l.trim())) ps.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr></w:pPr></w:p>');
        else ps.push(para(l, { ppr: '<w:spacing w:after="120"/>' }));
    }
    return ps;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** → Blob (.docx). */
export async function markdownToDocx(md) {
    const body = markdownToParagraphs(md).join('');
    const files = [
        { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
        { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
        { name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` }
    ];
    const zip = await buildZip(files);
    return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
