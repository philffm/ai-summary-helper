import WebKit

/// A web page reduced to its readable text, with what a research paper says about itself.
struct ExtractedPage: Equatable {
    var title: String
    var passages: [Passage]
    var paper: Paper?
}

enum PageExtract {
    /// Run in the page. Picks the article (or main, or the body) and collects headings, paragraphs, list items, quotes and
    /// code blocks, leaving out navigation, footers, forms and other page furniture. The same rules as the Android app
    /// (PageSummary.kt), plus the citation tags journals put into their pages.
    static let script = #"""
    (function(){
    var DROP='script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,select,dialog,[role=navigation],[role=banner],[role=complementary],[aria-hidden=true],.advert,.ads,.cookie,.cookies,#comments,.comments';
    function weight(el){var n=0,ps=el.querySelectorAll('p');for(var i=0;i<ps.length;i++){var t=ps[i].textContent||'';if(t.length>60)n+=t.length}return n}
    var root=null,best=0,c=document.querySelectorAll('article,main,[role=main]');
    for(var i=0;i<c.length;i++){var w=weight(c[i]);if(w>best){best=w;root=c[i]}}
    if(!root||best<300)root=document.body;
    var out=[],seen={},els=root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre');
    for(var j=0;j<els.length&&out.length<1500;j++){var e=els[j];
    var inside=e.closest(DROP);if(inside&&inside!==root&&root.contains(inside))continue;
    if(e.tagName==='BLOCKQUOTE'&&e.querySelector('p'))continue;
    if(e.tagName==='LI'&&e.querySelector('p'))continue;
    var t=(e.textContent||'').replace(/\s+/g,' ').trim();
    var tag=e.tagName.toLowerCase();
    if(tag==='blockquote')tag='q';
    var min=tag[0]==='h'?2:(tag==='li'?25:40);
    if(t.length<min||(tag[0]!=='h'&&seen[t]))continue;seen[t]=1;out.push([tag,t])}
    function metas(n){return [].map.call(document.querySelectorAll('meta[name="'+n+'" i]'),function(m){return (m.getAttribute('content')||'').trim()}).filter(Boolean)}
    var og=document.querySelector('meta[property="og:title"]');
    return JSON.stringify({title:metas('citation_title')[0]||(og&&og.content)||document.title||'',blocks:out,
    authors:metas('citation_author').slice(0,40),journal:metas('citation_journal_title')[0]||'',doi:metas('citation_doi')[0]||''})})()
    """#

    private struct Raw: Decodable {
        var title: String
        var blocks: [[String]]
        var authors: [String]
        var journal: String
        var doi: String
    }

    /// nil when there is no text worth keeping.
    static func page(from json: String) -> ExtractedPage? {
        guard let raw = try? JSONDecoder().decode(Raw.self, from: Data(json.utf8)) else { return nil }
        var passages: [Passage] = []
        for block in raw.blocks where block.count == 2 {
            let tag = block[0], text = block[1].trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            if tag.hasPrefix("h"), let level = Int(tag.dropFirst()) {
                // the page's own title stands above the text already
                if level == 1 && passages.isEmpty { continue }
                passages.append(Passage(text: text, heading: min(3, max(1, level - 1))))
            } else {
                // a list that brings its own numbers needs no point in front
                let point = tag == "li" && text.range(of: "^(\\[[0-9]+\\]|[0-9]+[.)])", options: .regularExpression) == nil
                passages.append(Passage(text: point ? "• " + text : text))
            }
        }
        guard passages.filter({ $0.heading == nil }).reduce(0, { $0 + $1.text.count }) >= 200 else { return nil }
        let doi = PaperSense.doi(in: raw.doi) ?? ""
        let paper = raw.authors.isEmpty && raw.journal.isEmpty && doi.isEmpty ? nil : Paper(authors: raw.authors, journal: raw.journal, doi: doi)
        return ExtractedPage(title: raw.title.trimmingCharacters(in: .whitespacesAndNewlines), passages: passages, paper: paper)
    }
}

/// Loads a page unseen, without cookies or stored data, and reads its text.
@MainActor
final class PageFetcher: NSObject, WKNavigationDelegate {
    private var web: WKWebView?
    private var done: CheckedContinuation<Bool, Never>?

    func fetch(_ url: URL, timeout: Duration = .seconds(25)) async -> ExtractedPage? {
        let setup = WKWebViewConfiguration()
        setup.websiteDataStore = .nonPersistent()
        setup.mediaTypesRequiringUserActionForPlayback = .all
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: setup)
        web.navigationDelegate = self
        self.web = web
        defer { web.stopLoading(); self.web = nil }
        let clock = Task { @MainActor [weak self] in
            try? await Task.sleep(for: timeout)
            // slow pictures or scripts: what has arrived by now is read
            if !Task.isCancelled { self?.finish(true) }
        }
        let loaded = await withCheckedContinuation { continuation in
            done = continuation
            web.load(URLRequest(url: url))
        }
        clock.cancel()
        guard loaded else { return nil }
        try? await Task.sleep(for: .seconds(1))   // pages that fill themselves in by script
        guard let json = try? await web.evaluateJavaScript(PageExtract.script) as? String else { return nil }
        return PageExtract.page(from: json)
    }

    private func finish(_ ok: Bool) {
        done?.resume(returning: ok)
        done = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish(true) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(false) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(false) }
}
