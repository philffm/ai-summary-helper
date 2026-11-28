import XCTest
@testable import Kaivo

/// The first start's explanation: once, for a library with nothing in it.
final class WelcomeTests: XCTestCase {
    func testWhenItIsShown() {
        XCTAssertTrue(WelcomeView.isDue(empty: true, seen: false, arguments: []))
        XCTAssertFalse(WelcomeView.isDue(empty: false, seen: false, arguments: []), "someone with articles knows the way")
        XCTAssertFalse(WelcomeView.isDue(empty: true, seen: true, arguments: []), "once")
        XCTAssertFalse(WelcomeView.isDue(empty: true, seen: false, arguments: ["-KaivoStartTab", "today"]), "a test or a screenshot goes straight in")
        XCTAssertTrue(WelcomeView.isDue(empty: false, seen: true, arguments: ["-KaivoWelcome", "YES"]))
    }
}
