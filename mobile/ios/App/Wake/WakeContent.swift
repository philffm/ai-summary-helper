import Foundation

/// What the alarm wakes you with.
enum WakeMode: String, Codable, CaseIterable, Identifiable {
    case briefing, article, remember
    var id: String { rawValue }
}

/// One story or the article that is read out.
struct WakeStory: Equatable, Identifiable {
    var id: String
    var title: String
    var source: String
    /// Shown and read after the title.
    var text: [String]
    /// A feed item that can be kept for later.
    var feed: FeedEntry?
    /// An article of the library that can be opened.
    var articleID: String?
}

enum WakeContent: Equatable {
    case briefing([WakeStory])
    case article(WakeStory)
    case remember(RecallCard, Cloze)
}

/// Chooses what to wake with from what is on the device. Pure, unit-tested.
enum WakeBuilder {
    static let maxStories = 7
    static let perFeed = 2

    /// Words that mark heavy headlines (war, crime, disasters, death), as GoodNews.kt on Android.
    private static let heavy: NSRegularExpression? = {
        let exact = "war|wars|dead|death|deaths|dies|died|dying|shot|crash|crashes|crashed|fire|fires|kills|toll|krieg|kriege|tod|tot|tote|toter|tode|brand|flut|opfer|toten"
        let stems = "kill|murder|attack|shoot|bomb|terror|earthquake|flood|wildfire|disaster|crisis|collaps|scandal|arrest|abus|stabb|hostage|explo|victim|casualt|invasion|sanction|recession|layoff|genocide|massacre|tragedy|tragic|fatal|injur|crimin|convict|lawsuit|outbreak|famine|threat|getötet|ermordet|mord|angriff|anschlag|schüsse|unfall|erdbeben|überschwemm|katastroph|krise|skandal|festgenomm|missbrauch|vergewalt|geisel|explosion|sanktion|rezession|entlassung|absturz|leiche|messer|tödlich|verletzt|verurteilt|klage|ausbruch|hungersnot|bedrohung"
        return try? NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}])(?:(?:\(exact))(?![\\p{L}\\p{N}])|(?:\(stems)))", options: [.caseInsensitive])
    }()

    static func isHeavy(_ text: String) -> Bool {
        heavy?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Unread stories, newest first, at most two per feed: from the last 36 hours, or from the last week on a quiet day.
    static func briefing(_ entries: [FeedEntry], noBadNews: Bool, now: Date = .now) -> [WakeStory] {
        let unread = entries.filter { entry in
            !entry.stored.read && !entry.stored.item.title.isEmpty && (!noBadNews || !isHeavy(entry.stored.item.title + " " + entry.stored.item.summary))
        }.sorted { ($0.stored.item.published ?? .distantPast) > ($1.stored.item.published ?? .distantPast) }
        func fresh(_ hours: Double) -> [WakeStory] {
            var taken: [String: Int] = [:]
            var out: [WakeStory] = []
            for entry in unread where out.count < maxStories {
                guard let published = entry.stored.item.published, now.timeIntervalSince(published) <= hours * 3600, taken[entry.feed.url, default: 0] < perFeed else { continue }
                taken[entry.feed.url, default: 0] += 1
                // the feed's teaser, else the start of its text
                let item = entry.stored.item
                let teaser = (item.summary.isEmpty ? item.body : item.summary).components(separatedBy: "\n\n").first ?? ""
                out.append(WakeStory(id: entry.id, title: entry.stored.item.title, source: entry.feed.name, text: teaser.isEmpty ? [] : [String(teaser.prefix(300))], feed: entry))
            }
            return out
        }
        let recent = fresh(36)
        return recent.isEmpty ? fresh(7 * 24) : recent
    }

    /// One unread article of the library; any article when all were opened.
    static func article(_ articles: [Article], seed: Int) -> WakeStory? {
        let unread = articles.filter(\.isUnread)
        let pool = unread.isEmpty ? articles : unread
        guard !pool.isEmpty else { return nil }
        let chosen = pool[((seed % pool.count) + pool.count) % pool.count]
        return WakeStory(id: chosen.id, title: chosen.title, source: chosen.host, text: chosen.passages.filter { $0.kind == .text }.map(\.text), articleID: chosen.id)
    }

    static func cards(_ articles: [Article]) -> [RecallCard] {
        articles.flatMap { article in
            article.passages.flatMap { passage in passage.marks.filter { !$0.ai }.map { RecallCard(articleID: article.id, title: article.title, text: passage.words(of: $0)) } }
        }
    }

    /// An empty library, or no highlight that is due, gives the briefing.
    static func content(_ mode: WakeMode, articles: [Article], entries: [FeedEntry], memos: [String: Memo], noBadNews: Bool, seed: Int, now: Date = .now) -> WakeContent {
        switch mode {
        case .article:
            if let story = article(articles, seed: seed) { return .article(story) }
        case .remember:
            if let card = Recall.pick(cards(articles), memos: memos, day: Recall.today(now), seed: seed), let cloze = Recall.cloze(card.text, seed: seed) { return .remember(card, cloze) }
        case .briefing:
            break
        }
        return .briefing(briefing(entries, noBadNews: noBadNews, now: now))
    }
}
