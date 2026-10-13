// odtExport.js — Markdown note → OpenDocument text (.odt): the open standard behind LibreOffice, OnlyOffice, Collabora,
// Nextcloud and Apple Pages, and also readable by Word. Same input as docxExport.js; again just a zip of a few XML parts
// (the "mimetype" entry has to come first and uncompressed — buildZip stores everything).
import { buildZip } from './markdownArchive.js';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Inline Markdown → text:span runs (T-Bold / T-Italic / T-Code automatic styles). */
function inline(text) {
    const t = String(text).replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '[$1]').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, u) => a === u ? a : `${a} (${u})`);
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let out = '', last = 0, m;
    while ((m = re.exec(t))) {
        out += esc(t.slice(last, m.index));
        const [style, s] = m[1] !== undefined ? ['TBold', m[1]] : m[2] !== undefined ? ['TItalic', m[2]] : ['TCode', m[3]];
        out += `<text:span text:style-name="${style}">${esc(s)}</text:span>`;
        last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
}

/** Markdown (no front matter) → office:text body. */
export function markdownToOdtBody(md) {
    const out = []; let list = [];
    const flush = () => { if (list.length) { out.push(`<text:list>${list.map(i => `<text:list-item><text:p text:style-name="Text_20_body">${i}</text:p></text:list-item>`).join('')}</text:list>`); list = []; } };
    for (const line of String(md || '').split(/\r?\n/)) {
        const l = line.replace(/\s+$/, '');
        if (!l.trim()) continue;
        let m;
        if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { list.push(inline(m[1])); continue; }
        flush();
        if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { const n = Math.min(4, m[1].length); out.push(`<text:h text:style-name="Heading_20_${n}" text:outline-level="${n}">${inline(m[2])}</text:h>`); }
        else if ((m = /^>\s?(.*)$/.exec(l))) out.push(`<text:p text:style-name="Quotations">${inline(m[1])}</text:p>`);
        else if (/^-{3,}$/.test(l.trim())) out.push('<text:p text:style-name="Horizontal_20_Line"/>');
        else out.push(`<text:p text:style-name="Text_20_body">${inline(l)}</text:p>`);
    }
    flush();
    return out.join('');
}

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    + 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
    + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const MIME = 'application/vnd.oasis.opendocument.text';

const para = (name, parent, props) => `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${props}/></style:style>`;
const head = (n, size) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:next-style-name="Text_20_body" style:default-outline-level="${n}"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`;
const text = (name, props) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`;

/** → Blob (.odt). */
export async function markdownToOdt(md) {
    const styles = '<?xml version="1.0" encoding="UTF-8"?>'
        + `<office:document-styles ${NS} office:version="1.2"><office:styles>`
        + '<style:default-style style:family="paragraph"><style:text-properties fo:font-size="11pt" fo:language="en"/></style:default-style>'
        + '<style:style style:name="Standard" style:family="paragraph"/>'
        + '<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.21cm"/></style:style>'
        + [1, 2, 3, 4].map((n, i) => head(n, [20, 16, 14, 13][i])).join('')
        + para('Quotations', 'Standard', 'fo:margin-left="0.8cm" fo:margin-bottom="0.21cm" fo:border-left="0.05cm solid #aaaaaa" fo:padding-left="0.3cm"')
        + para('Horizontal_20_Line', 'Standard', 'fo:border-bottom="0.002cm solid #aaaaaa" fo:margin-bottom="0.2cm"')
        + '</office:styles></office:document-styles>';
    const content = '<?xml version="1.0" encoding="UTF-8"?>'
        + `<office:document-content ${NS} office:version="1.2"><office:automatic-styles>`
        + text('TBold', 'fo:font-weight="bold"') + text('TItalic', 'fo:font-style="italic"') + text('TCode', 'style:font-name="Liberation Mono" fo:font-family="monospace"')
        + `</office:automatic-styles><office:body><office:text>${markdownToOdtBody(md)}</office:text></office:body></office:document-content>`;
    const manifest = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
        + `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/>`
        + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        + '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
        + '</manifest:manifest>';
    const zip = await buildZip([
        { name: 'mimetype', text: MIME },
        { name: 'META-INF/manifest.xml', text: manifest },
        { name: 'content.xml', text: content },
        { name: 'styles.xml', text: styles }
    ]);
    return new Blob([zip], { type: MIME });
}
