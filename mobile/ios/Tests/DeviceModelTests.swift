import XCTest
@testable import Kaivo

/// The model on this device: when it is used, how a text is cut for it, and what is remembered about its summaries. The
/// model itself is not asked: neither this Mac nor the simulator has it switched on.
final class DeviceModelTests: XCTestCase {
    override func tearDown() { UserDefaults.standard.removeObject(forKey: "KaivoDeviceModel") }

    private var server: ModelEndpoint { ModelEndpoint.own(ModelServer(address: "192.168.1.20:11434", model: "m"))! }

    func testItIsUsedOnlyWhenReadyAndNothingElseIsSetUp() throws {
        for state in [DeviceModel.State.off, .loading, .notEligible, .unsupported] { XCTAssertNil(ModelEndpoint.device(state)) }
        let device = try XCTUnwrap(ModelEndpoint.device(.ready))
        XCTAssertEqual(ModelEndpoint.choose(safari: nil, own: nil, preferOwn: false, device: device)?.format, .device)
        XCTAssertEqual(ModelEndpoint.choose(safari: nil, own: server, preferOwn: false, device: device), server)
        XCTAssertEqual(ModelEndpoint.choose(safari: server, own: nil, preferOwn: true, device: device), server)
        XCTAssertNil(ModelEndpoint.choose(safari: nil, own: nil, preferOwn: false, device: nil))
    }

    func testNothingLeavesTheDeviceSoNothingIsAsked() throws {
        let device = try XCTUnwrap(ModelEndpoint.device(.ready))
        XCTAssertFalse(AIConsent(store: UserDefaults(suiteName: "tests-device")!).isNeeded(for: device))
        XCTAssertThrowsError(try device.request(system: "s", user: "u"), "it is never asked over the network")
    }

    func testPartsFitTheSmallWindow() {
        let latin = DeviceModel.parts(for: String(repeating: "Ein ganz normaler Satz. ", count: 400))
        let dense = DeviceModel.parts(for: String(repeating: "睡眠は記憶を固める。", count: 600))
        XCTAssertEqual(latin.size, 5000)
        XCTAssertEqual(dense.size, 1800)
        XCTAssertGreaterThan(dense.most, latin.most)
        let parts = SummaryPrompt.parts(String(repeating: "睡眠は記憶を固める。", count: 600), size: dense.size, most: dense.most)
        XCTAssertGreaterThan(parts.count, 1)
        XCTAssertTrue(parts.allSatisfy { $0.count <= dense.size })
    }

    @MainActor
    func testASummaryFromTheDeviceSaysSo() async throws {
        UserDefaults.standard.set("ready", forKey: "KaivoDeviceModel")
        let library = Library(samples: true)
        let article = try XCTUnwrap(library.articles.first { $0.passages.map(\.text).joined().count > SummaryPrompt.minText })
        let summaries = Summaries()
        summaries.endpoint = { ModelEndpoint.device(DeviceModel.state) }
        summaries.summarize(article.id, in: library)
        XCTAssertNil(summaries.question)
        for _ in 0..<100 where summaries.isWaiting(article.id) { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertNil(summaries.failure)
        XCTAssertEqual(library.article(article.id)?.summaryOnDevice, true)
        XCTAssertEqual(library.article(article.id)?.summary.count, 2)
    }

    func testOnlyTheDevicesOwnSummaryIsMarked() throws {
        func read(_ summary: String, written: String?) -> Bool? {
            LibraryRecords.article(entry: ["id": "a", "url": "https://example.org/a"], record: ["summary": summary], highlights: [],
                                   extra: LibraryRecords.Extra(deviceSummary: written))?.summaryOnDevice
        }
        XCTAssertEqual(read("<p>One.</p>", written: "<p>One.</p>"), true)
        XCTAssertNil(read("<p>Another, from the computer.</p>", written: "<p>One.</p>"))
        XCTAssertNil(read("", written: nil))
    }
}
