// TEMPORARY: sample reading for debug builds (and the App Store screenshot drafts), until the app reads what the extension
// saved. Titles and tags are those of the web demo (plugin/demo/demo-content.js), the hosts are made up (.example), the
// article texts are placeholders written for these screens.
#if DEBUG
import Foundation

enum SampleData {
    static var articles: [Article] {
        let tag = (
            ai: String(localized: "ai"), climate: String(localized: "climate"), energy: String(localized: "energy"),
            health: String(localized: "health"), science: String(localized: "science"), memory: String(localized: "memory"),
            privacy: String(localized: "privacy"), software: String(localized: "software"), web: String(localized: "web"),
            media: String(localized: "media"), reading: String(localized: "reading"), policy: String(localized: "policy"),
            law: String(localized: "law"), design: String(localized: "design"), cities: String(localized: "cities")
        )
        return [
            Article(id: "local-first", title: String(localized: "Why local-first software keeps coming back"), host: "localfirst.example",
                    tags: [tag.software, tag.privacy], words: 2100, savedAt: ago(0), progress: 0.6,
                    passages: [Passage(kind: .text, text: String(localized: "Software that keeps its data on your device keeps working when a service changes or closes."))]),
            Article(id: "energy-query", title: String(localized: "The energy cost of a single AI query"), host: "energywatch.example",
                    tags: [tag.ai, tag.climate, tag.energy], words: 1500, savedAt: ago(0)),
            Article(id: "sleep-memory", title: String(localized: "How sleep consolidates memory"), host: "brainjournal.example",
                    tags: [tag.health, tag.science, tag.memory], words: 1800, savedAt: ago(1), progress: 0.35,
                    passages: [
                        Passage(kind: .text, text: String(localized: "During deep sleep the brain goes over the day again.")),
                        Passage.marked(String(localized: "Sleep moves what you read today into what you know next week.")),
                        Passage.marked(String(localized: "A short review the next morning keeps more than a second reading the same evening."), ai: true),
                        Passage(kind: .text, text: String(localized: "Which stage of sleep matters most is still being discussed.")),
                    ],
                    summary: [String(localized: "Sleep helps what you have read to stay."), String(localized: "A short review the next day adds to it.")]),
            Article(id: "rss-history", title: String(localized: "A short history of the RSS feed"), host: "webhistory.example",
                    tags: [tag.web, tag.media, tag.reading], words: 1300, savedAt: ago(2), progress: 1),
            Article(id: "data-law", title: String(localized: "What a fair data-sharing law would look like"), host: "policyreview.example",
                    tags: [tag.privacy, tag.policy, tag.law], words: 2600, savedAt: ago(3)),
            Article(id: "small-models", title: String(localized: "Small language models are catching up"), host: "ai-weekly.example",
                    tags: [tag.ai, tag.software], words: 1700, savedAt: ago(3),
                    passages: [Passage.marked(String(localized: "Models that fit on a laptop handle everyday summaries."))]),
            Article(id: "slow-attention", title: String(localized: "Interface design for slow attention"), host: "designnotes.example",
                    tags: [tag.design, tag.reading], words: 1400, savedAt: ago(5), progress: 1),
            Article(id: "trees", title: String(localized: "Cities that planted trees and cooled down"), host: "climatedesk.example",
                    tags: [tag.climate, tag.cities, tag.health], words: 1350, savedAt: ago(10)),
        ]
    }

    private static func ago(_ days: Int) -> Date { Calendar.current.date(byAdding: .day, value: -days, to: .now) ?? .now }

    /// Three made-up feeds with the same headlines.
    static var feeds: ([Feed], [String: FeedState]) {
        let sources: [(String, String, [(String, Int)])] = [
            ("Energy Watch", "https://energywatch.example/feed", [(String(localized: "The energy cost of a single AI query"), 0), (String(localized: "Cities that planted trees and cooled down"), 2)]),
            ("Policy Review", "https://policyreview.example/feed", [(String(localized: "What a fair data-sharing law would look like"), 0)]),
            ("Web History", "https://webhistory.example/feed", [(String(localized: "A short history of the RSS feed"), 1), (String(localized: "Interface design for slow attention"), 3)]),
        ]
        var list: [Feed] = []
        var states: [String: FeedState] = [:]
        for (name, url, items) in sources {
            list.append(Feed(url: url, title: name, updatedAt: 0))
            states[url] = FeedState(items: items.enumerated().map { index, entry in
                StoredItem(item: FeedItem(id: "\(index)", title: entry.0, link: "\(url)/\(index)", published: ago(entry.1),
                                          body: String(localized: "Software that keeps its data on your device keeps working when a service changes or closes.")),
                           read: entry.1 > 1)
            }, lastFetched: .now)
        }
        return (list, states)
    }
}
#endif
