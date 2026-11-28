import XCTest
@testable import Kaivo

/// Asking about an article: who is asked, what a yes is needed for, and what a small model gets.
@MainActor
final class QuestionsTests: XCTestCase {
    private func long(_ library: Library) throws -> Article {
        try XCTUnwrap(library.articles.first { $0.passages.map(\.text).joined().count > 200 })
    }

    private func wait(_ questions: Questions) async throws {
        for _ in 0..<200 where !questions.asking.isEmpty { try await Task.sleep(for: .milliseconds(20)) }
    }

    func testWithoutAModelItSaysSo() throws {
        let library = Library(samples: true)
        let questions = Questions()
        questions.endpoint = { nil }
        XCTAssertFalse(questions.send("Why?", about: try long(library).id, in: library))
        XCTAssertTrue(questions.send("   ", about: try long(library).id, in: library), "nothing to ask is nothing to set up")
    }

    func testNothingLeavesWithoutAYes() async throws {
        let library = Library(samples: true)
        let article = try long(library)
        let questions = Questions()
        questions.consent = AIConsent(store: UserDefaults(suiteName: "tests-" + UUID().uuidString)!)
        var asked = 0
        questions.ask = { _, _, _ in asked += 1; return "Yes." }
        questions.endpoint = { ModelEndpoint(url: URL(string: "https://api.example.com/v1/chat/completions")!, model: "m", name: "Example") }
        XCTAssertTrue(questions.send("Why?", about: article.id, in: library))
        let waiting = try XCTUnwrap(questions.consentFor)
        XCTAssertEqual(asked, 0)
        questions.answer(waiting, allow: false, in: library)
        XCTAssertEqual(asked, 0)
        questions.send("Why?", about: article.id, in: library)
        questions.answer(try XCTUnwrap(questions.consentFor), allow: true, in: library)
        try await wait(questions)
        XCTAssertEqual(asked, 1)
        XCTAssertEqual(library.article(article.id)?.questions?.last?.answer, "Yes.")
    }

    func testTheModelOnTheDeviceGetsLessAndOnceMoreHalfOfIt() async throws {
        let library = Library(samples: true)
        let article = try long(library)
        let questions = Questions()
        questions.endpoint = { ModelEndpoint.device(.ready) }
        var lengths: [Int] = []
        questions.ask = { _, _, user in
            lengths.append(user.count)
            if lengths.count == 1 { throw DeviceModel.Failure.tooLong }
            return "Short."
        }
        questions.send("Why?", about: article.id, in: library)
        XCTAssertNil(questions.consentFor, "nothing leaves the device")
        try await wait(questions)
        XCTAssertNil(questions.failure)
        XCTAssertEqual(lengths.count, 2)
        XCTAssertLessThanOrEqual(lengths[0], 7100)
    }
}
