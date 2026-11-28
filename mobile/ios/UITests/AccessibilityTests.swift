import XCTest

/// The system's accessibility audit over the main screens, and pictures of them in the largest text size. It writes what
/// it finds into a folder and only runs on request: TEST_RUNNER_KAIVO_AUDIT=<folder>.
final class AccessibilityTests: XCTestCase {
    @MainActor
    func testAudit() throws {
        guard let folder = ProcessInfo.processInfo.environment["KAIVO_AUDIT"] else { throw XCTSkip("only on request") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        continueAfterFailure = true
        let app = XCUIApplication()
        var found: [String] = []
        func start(_ more: [String]) {
            app.terminate()
            app.launchArguments = ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE", "-KaivoScreenshots", "YES"] + more
            app.launch()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60))
            Thread.sleep(forTimeInterval: 6)
        }
        func audit(_ screen: String) {
            guard #available(iOS 17.0, *) else { return }
            do {
                try app.performAccessibilityAudit { issue in
                    let element = issue.element.map { "\($0.elementType.rawValue) '\($0.label.prefix(50))' \($0.identifier) \($0.frame.integral)" } ?? "-"
                    found.append("\(screen) | \(issue.compactDescription) | \(element)")
                    return true
                }
            } catch {
                found.append("\(screen) | audit did not run: \(error.localizedDescription)")
            }
            // after each screen, so that a run that breaks off leaves what it found
            XCTAssertNoThrow(try found.joined(separator: "\n").write(toFile: folder + "/findings.txt", atomically: true, encoding: .utf8))
        }
        func shot(_ name: String) {
            Thread.sleep(forTimeInterval: 1.5)
            XCTAssertNoThrow(try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name).png")))
        }
        let large = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        for (suffix, size) in [("", [String]()), ("-large", large)] {
            for tab in ["today", "library", "feeds", "notes"] {
                start(["-KaivoStartTab", tab] + size)
                audit(tab + suffix)
                shot(tab + suffix)
            }
            start(["-KaivoStartTab", "library", "-KaivoStartArticle", "sleep-memory"] + size)
            audit("reader" + suffix)
            shot("reader" + suffix)
            let menu = app.buttons["reader-menu"].firstMatch
            if menu.waitForExistence(timeout: 10) {
                menu.tap()
                for (index, name) in ["summary", "text", "listen", "more"].enumerated() {
                    let pages = app.descendants(matching: .any)["menu-pages"].firstMatch
                    guard pages.waitForExistence(timeout: 10) else { found.append("menu-\(name)\(suffix) | the tabs are missing"); break }
                    // the tabs, or the menu that stands for them at large sizes
                    if index > 0 {
                        if pages.buttons.count >= 4 { pages.buttons.element(boundBy: index).tap() }
                        else { pages.tap(); app.buttons[["Kurzfassung", "Text", "Anhören", "Mehr"][index]].firstMatch.tap() }
                    }
                    audit("menu-\(name)\(suffix)")
                    shot("menu-\(name)\(suffix)")
                }
            }
            start(["-KaivoStartTab", "today"] + size)
            let settings = app.buttons["Einstellungen"].firstMatch
            if settings.waitForExistence(timeout: 10) {
                settings.tap()
                audit("settings" + suffix)
                shot("settings" + suffix)
            }
        }
        try found.joined(separator: "\n").write(toFile: folder + "/findings.txt", atomically: true, encoding: .utf8)
    }
}
