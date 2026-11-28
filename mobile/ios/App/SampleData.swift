// TEMPORARY: sample reading for debug builds (and the App Store screenshot drafts), until the app reads what the extension
// saved. Titles and tags are those of the web demo (plugin/demo/demo-content.js), the hosts are made up (.example), the
// article texts are placeholders written for these screens.
#if DEBUG
import Foundation

enum SampleData {
    static var articles: [Article] { shortArticles + stories }

    private static var shortArticles: [Article] {
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
                    tags: [tag.ai, tag.climate, tag.energy], words: 1500, savedAt: ago(0),
                    passages: [Passage(kind: .text, text: String(localized: "One question to a model costs little energy, about as little as it feels. Billions of them a day add up to a power plant’s worth of work. Nobody notices a single one, which is exactly why the total surprises people.")),
                               Passage(kind: .text, text: String(localized: "Where the power comes from matters as much as how much is used. The same answer is cheap at noon in a sunny grid and dear on a windless night. Some providers publish that difference, most still do not."))]),
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
                    tags: [tag.web, tag.media, tag.reading], words: 1300, savedAt: ago(2), progress: 1,
                    passages: [Passage(kind: .text, text: String(localized: "A feed is a plain list of what is new on a site, written for programs to read. It has outlived several services that promised to replace it. Its charm is that it does nothing clever.")),
                               Passage(kind: .text, text: String(localized: "You choose the sources, and no ranking stands in between. What you see is what was published, in the order it was published. If it gets too much, you remove a source instead of arguing with an algorithm."))]),
            Article(id: "data-law", title: String(localized: "What a fair data-sharing law would look like"), host: "policyreview.example",
                    tags: [tag.privacy, tag.policy, tag.law], words: 2600, savedAt: ago(3),
                    passages: [Passage(kind: .text, text: String(localized: "People should be able to take their data with them when they change services. That sounds obvious until someone asks which data, in what format and by when. A good law answers all three in plain words.")),
                               Passage(kind: .text, text: String(localized: "Whoever reuses data has to say what for, and has to ask first. Consent that hides on page nine of a contract does not count. The test is whether the person would be surprised to learn what happened."))]),
            Article(id: "small-models", title: String(localized: "Small language models are catching up"), host: "ai-weekly.example",
                    tags: [tag.ai, tag.software], words: 1700, savedAt: ago(3),
                    passages: [Passage.marked(String(localized: "Models that fit on a laptop handle everyday summaries."))]),
            Article(id: "slow-attention", title: String(localized: "Interface design for slow attention"), host: "designnotes.example",
                    tags: [tag.design, tag.reading], words: 1400, savedAt: ago(5), progress: 1),
            Article(id: "trees", title: String(localized: "Cities that planted trees and cooled down"), host: "climatedesk.example",
                    tags: [tag.climate, tag.cities, tag.health], words: 1350, savedAt: ago(10)),
        ]
    }

    /// The longer pieces, in `Samples/stories.<language>.json`: four invented ones, and our summary of a real study
    /// (PLOS ONE, CC BY, credited in its last paragraph). Languages without a file read the English one.
    static var stories: [Article] {
        struct Story: Decodable { var id, title, host, link, mark, ai: String; var tags, passages, summary: [String] }
        let language = Bundle.main.preferredLocalizations.first ?? "en"
        guard let url = Bundle.main.url(forResource: "stories.\(language)", withExtension: "json") ?? Bundle.main.url(forResource: "stories.en", withExtension: "json"),
              let data = try? Data(contentsOf: url), let list = try? JSONDecoder().decode([Story].self, from: data) else { return [] }
        return list.enumerated().map { index, story in
            let passages = story.passages.map { text -> Passage in
                var passage = Passage(kind: .text, text: text)
                for (words, ai) in [(story.mark, false), (story.ai, true)] {
                    let range = (text as NSString).range(of: words)
                    if !words.isEmpty && range.location != NSNotFound { passage.marks.append(Mark(start: range.location, length: range.length, ai: ai)) }
                }
                passage.marks.sort { $0.start < $1.start }
                return passage
            }
            let text = story.passages.joined(separator: " ")
            // languages written without spaces: about two characters to a word
            let words = ["ja", "zh"].contains(where: language.hasPrefix) ? text.count / 2 : Library.words(in: text)
            return Article(id: "story-" + story.id, title: story.title, host: story.host, tags: story.tags, words: words, savedAt: ago(index + 1),
                           passages: passages, summary: story.summary, link: story.link)
        }
    }

    /// A real podcast, so that listening can be tried and shown: the newest episodes of philwornath.com's feed.
    private static var podcast: (Feed, FeedState) {
        let url = "https://philwornath.com/api/podcast.xml"
        let episodes: [(Double, String, String, String, String)] = [
            (1793664000, "Digital Sovereignty as a Designer", "https://philwornath.com/garden/digital-sovereignty-designer",
             "https://philwornath.com/assets/content/digital-sovereignty-designer.mp3",
             "To design is to be 'in charge' - to be the architect of an experience. But how much authority do we actually have when our entire digital existence is hosted in a controlled environment we didn't build and don't own?"),
            (1790553600, "Between Noodles and Wires: How AI is Democratizing Hardware Design", "https://philwornath.com/garden/ai-hardware-prototyping",
             "https://philwornath.com/assets/content/ai-hardware-prototyping.mp3",
             "How moving past screenshots and feeding raw KiCad files to an LLM helped me break out of the breadboard prototyping phase and manufacture a custom PCBA on the road."),
            (1789603200, "End of the line: why Deutsche Bahn's vegan currywurst had to go", "https://philwornath.com/garden/post-mortem-bordrestaurant",
             "https://philwornath.com/assets/content/post-mortem-bordrestaurant.mp3",
             "Germany's railway dropped its vegan currywurst. What's left shows how menus quietly ration choice, and why protein per euro tells the real story."),
            (1776038400, "A Frictionless, Self-Hosted E-Book Sync Between Android, Kindle and KOReader", "https://philwornath.com/garden/self-hosted-ebook-sync-koreader",
             "https://philwornath.com/assets/content/self-hosted-ebook-sync-koreader.mp3",
             "Learn how to build a decentralized, self-hosted e-book library using a VPS, Syncthing, and KOReader. Sync reading progress across devices with zero lock-in.")
        ]
        let items = episodes.map { date, title, link, audio, text in
            StoredItem(item: FeedItem(id: link, title: title, link: link, published: Date(timeIntervalSince1970: date), summary: text, body: text, audio: audio))
        }
        return (Feed(url: url, title: "Street Phil-osophy", updatedAt: 0), FeedState(items: items, lastFetched: .now))
    }

    /// The samples as real files. Only the AI's suggestion is marked in them, so that the highlight widget starts empty
    /// and then shows what was kept during the demo.
    @MainActor
    static func seed() {
        let library = articles.map { article in
            var plain = article
            plain.passages = article.passages.map { passage in
                var p = passage
                p.marks.removeAll { !$0.ai }
                return p
            }
            return plain
        }
        // "Continue reading" takes the first started article: the one the demo works with, and when that is read to the
        // end, the next one, so the widget is never empty
        let ordered = library.filter { $0.id == "sleep-memory" } + library.filter { $0.id != "sleep-memory" }
        // Recording mode (`-KaivoDemo YES`, only the video scripts): the touches are drawn and the Safari setup row is
        // left out. Kept in the settings, because the demo also opens the app from a widget, without launch options.
        // Loading the samples without it gives the app as it normally looks.
        if LaunchOptions.demo { UserDefaults.standard.set(true, forKey: "KaivoTouches") }
        else { UserDefaults.standard.removeObject(forKey: "KaivoTouches") }
        // the library starts over from these: taken over like the one the app kept before
        try? FileManager.default.removeItem(at: LibraryStore.folder)
        SharedStore.write(ordered, to: LibraryStore.oldFile)
        let (list, states) = feeds
        FeedsModel.seed(list, states)
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
                // the text of the sample article with the same title, so that a story never shows another story's words
                let text = articles.first { $0.title == entry.0 }?.passages.filter { $0.kind == .text }.map(\.text).joined(separator: "\n\n") ?? ""
                return StoredItem(item: FeedItem(id: "\(index)", title: entry.0, link: "\(url)/\(index)", published: ago(entry.1), body: text),
                           read: entry.1 > 1)
            }, lastFetched: .now)
        }
        let (cast, state) = podcast
        list.append(cast)
        states[cast.url] = state
        return (list, states)
    }
}
#endif
