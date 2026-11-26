import Foundation

/// Tells a research paper from other articles, and where its abstract and its references lie.
enum PaperSense {
    private static let abstracts: Set<String> = ["abstract", "summary", "zusammenfassung", "kurzfassung", "résumé", "resumen",
                                                 "resumo", "аннотация", "tiivistelmä", "анотація", "摘要", "초록", "要旨", "الملخص"]
    private static let referenceNames: Set<String> = ["references", "bibliography", "literature cited", "literatur", "literaturverzeichnis",
                                                      "references and notes", "références", "referencias", "referências", "литература",
                                                      "список литературы", "lähteet", "література", "参考文献", "참고문헌", "المراجع"]
    private static let hosts = ["arxiv.org", "biorxiv.org", "medrxiv.org", "doi.org", "nature.com", "sciencedirect.com", "link.springer.com",
                                "journals.plos.org", "ncbi.nlm.nih.gov", "dl.acm.org", "ieeexplore.ieee.org", "onlinelibrary.wiley.com",
                                "science.org", "mdpi.com", "frontiersin.org", "tandfonline.com", "academic.oup.com", "journals.sagepub.com",
                                "pnas.org", "cell.com", "ssrn.com", "osf.io", "zenodo.org"]

    /// A heading without its number and punctuation: "5. References:" → "references".
    static func name(_ heading: String) -> String {
        heading.lowercased().replacingOccurrences(of: "^\\s*([0-9]+|[ivx]+)[.)]?\\s+", with: "", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " :.\t\n"))
    }

    static func isAbstract(_ passage: Passage) -> Bool { passage.heading != nil && abstracts.contains(name(passage.text)) }
    static func isReferences(_ passage: Passage) -> Bool { passage.heading != nil && referenceNames.contains(name(passage.text)) }

    static func doi(in text: String) -> String? {
        guard let range = text.range(of: "10\\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+", options: .regularExpression) else { return nil }
        return String(text[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".;:)/"))
    }

    static func isPaper(_ article: Article) -> Bool {
        if article.paper != nil { return true }
        let abstract = article.passages.contains(where: isAbstract), references = article.passages.contains(where: isReferences)
        // a blog can end in sources, and begin with a summary: only both under these very names count on their own
        if references && article.passages.contains(where: { $0.heading != nil && name($0.text) == "abstract" }) { return true }
        let host = article.host.lowercased()
        let journal = hosts.contains { host == $0 || host.hasSuffix("." + $0) }
        return journal && (abstract || references || doi(in: article.link) != nil || article.link.contains("arxiv.org/abs/"))
    }

    /// The paragraphs of the abstract (under its heading, up to the next one).
    static func abstract(_ passages: [Passage]) -> Range<Int>? {
        guard let heading = passages.firstIndex(where: isAbstract) else { return nil }
        let start = heading + 1
        let end = passages[start...].firstIndex { $0.heading != nil } ?? passages.count
        return start < end ? start..<end : nil
    }

    /// What follows the references heading, up to the next heading of the same or a higher level.
    static func references(_ passages: [Passage]) -> Range<Int>? {
        guard let heading = passages.lastIndex(where: isReferences) else { return nil }
        let level = passages[heading].heading ?? 3, start = heading + 1
        let end = passages[start...].firstIndex { ($0.heading ?? 4) <= level } ?? passages.count
        return start < end ? start..<end : nil
    }

    /// Where numbered citations such as [3] or [4–7, 9] stand.
    static func citations(in text: String) -> [NSRange] {
        guard let re = try? NSRegularExpression(pattern: "\\[[0-9]{1,3}(\\s?[,–-]\\s?[0-9]{1,3})*\\]") else { return [] }
        return re.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length)).map(\.range)
    }
}
