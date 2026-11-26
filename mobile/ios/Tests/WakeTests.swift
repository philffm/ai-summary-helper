import XCTest
@testable import Kaivo

final class WakeTests: XCTestCase {
    private let text = "A short review the next morning keeps more than a second reading the same evening."

    func testClozeLeavesOutOneLongWord() throws {
        let cloze = try XCTUnwrap(Recall.cloze(text, seed: 0))
        XCTAssertEqual(cloze.before + cloze.answer + cloze.after, text)
        XCTAssertGreaterThanOrEqual(cloze.answer.count, 5)
        XCTAssertEqual(Recall.cloze(text, seed: 0), cloze)
        XCTAssertNil(Recall.cloze("Sleep helps memory.", seed: 0))
        XCTAssertNil(Recall.cloze("it is on to be or at all of us", seed: 0))
        XCTAssertNotNil(Recall.cloze(text, seed: Int.min))
    }

    func testAskedHighlightsComeBackLater() {
        let a = RecallCard(articleID: "1", title: "A", text: text)
        let b = RecallCard(articleID: "2", title: "B", text: "Notes you can find again are worth more than notes you only wrote.")
        XCTAssertEqual(Recall.pick([a, b], memos: [a.key: Memo(due: 0, step: 1)], day: 10, seed: 5), b)
        XCTAssertEqual(Recall.pick([a, b], memos: [a.key: Memo(due: 10, step: 1), b.key: Memo(due: 11, step: 1)], day: 10, seed: 3), a)
        XCTAssertNil(Recall.pick([a], memos: [a.key: Memo(due: 11, step: 1)], day: 10, seed: 0))
        XCTAssertEqual(Recall.answer(nil, knew: true, day: 10), Memo(due: 12, step: 1))
        XCTAssertEqual(Recall.answer(Memo(due: 10, step: 9), knew: true, day: 10), Memo(due: 74, step: 10))
        XCTAssertEqual(Recall.answer(Memo(due: 10, step: 4), knew: false, day: 10), Memo(due: 11, step: 0))
    }

    func testBriefingAndFallbacks() {
        let now = Date.now
        func entry(_ feed: String, _ title: String, hours: Double, read: Bool = false) -> FeedEntry {
            FeedEntry(feed: Feed(url: feed, updatedAt: 0), stored: StoredItem(item: FeedItem(id: title, title: title, link: "https://x.test/" + title, published: now.addingTimeInterval(-hours * 3600)), read: read))
        }
        let entries = [entry("a", "Old news", hours: 100), entry("a", "One", hours: 1), entry("a", "Two", hours: 2), entry("a", "Three", hours: 3),
                       entry("b", "Earthquake hits", hours: 4), entry("b", "Seen", hours: 1, read: true)]
        XCTAssertEqual(WakeBuilder.briefing(entries, noBadNews: false, now: now).map(\.title), ["One", "Two", "Earthquake hits"])
        XCTAssertEqual(WakeBuilder.briefing(entries, noBadNews: true, now: now).map(\.title), ["One", "Two"])
        XCTAssertEqual(WakeBuilder.briefing([entry("a", "Old news", hours: 100)], noBadNews: false, now: now).map(\.title), ["Old news"])
        XCTAssertFalse(WakeBuilder.isHeavy("A new software release"))
        // nothing to ask and nothing to read: the briefing
        for mode in [WakeMode.article, .remember] {
            guard case .briefing = WakeBuilder.content(mode, articles: [], entries: entries, memos: [:], noBadNews: false, seed: 1, now: now) else { return XCTFail("expected the briefing") }
        }
        let article = Article(id: "1", title: "T", host: "x.test", tags: [], words: 10, savedAt: now, passages: [Passage.marked(text)])
        guard case .article(let story) = WakeBuilder.content(.article, articles: [article], entries: [], memos: [:], noBadNews: false, seed: 7, now: now) else { return XCTFail("expected the article") }
        XCTAssertEqual(story.articleID, "1")
        guard case .remember(let card, let cloze) = WakeBuilder.content(.remember, articles: [article], entries: [], memos: [:], noBadNews: false, seed: 7, now: now) else { return XCTFail("expected a question") }
        XCTAssertEqual(card.text, text)
        XCTAssertFalse(cloze.answer.isEmpty)
    }

    func testSettingsSurviveSaving() throws {
        var settings = WakeSettings()
        settings.days = [6, 7]; settings.button = .snooze; settings.sound = WakeSound.well
        XCTAssertEqual(try JSONDecoder().decode(WakeSettings.self, from: JSONEncoder().encode(settings)), settings)
        XCTAssertNotNil(Bundle.main.url(forResource: "well", withExtension: "caf"), "the alarm sound is in the app")
    }

    func testTextIsReadSentenceBySentence() {
        XCTAssertEqual(WakeVoice.sentences("One thing. And another? 第三句。第四句。"), ["One thing.", "And another?", "第三句。", "第四句。"])
        XCTAssertEqual(WakeVoice.sentences("no full stop"), ["no full stop"])
    }
}
