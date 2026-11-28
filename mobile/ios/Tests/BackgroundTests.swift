import XCTest
@testable import Kaivo

/// Work the system starts without the app being opened.
@MainActor
final class BackgroundTests: XCTestCase {
    func testWithoutALibraryOrFeedsItJustEnds() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "background-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appending(path: "shared"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = Library(samples: false, store: try LibraryStore(folder: root.appending(path: "library"), shared: root.appending(path: "shared"),
                                                                      vault: SyncVault(scope: "background-" + UUID().uuidString)))
        let sync = SyncModel(library: library)
        await BackgroundRefresh.run(library: library, feeds: FeedsModel(samples: true), sync: sync)
        XCTAssertNil(sync.state)
        XCTAssertNil(sync.problem)
        XCTAssertTrue(BackgroundRefresh.identifier.hasSuffix(".refresh"))
        let allowed = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String]
        XCTAssertEqual(allowed, [BackgroundRefresh.identifier], "the system only runs what the app names")
        XCTAssertTrue((Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("fetch") == true)
    }
}
