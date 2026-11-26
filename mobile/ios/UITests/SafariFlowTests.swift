import XCTest

/// The Kaivo extension in Safari on the folded iPhone Duo: mark a sentence, comment on a word, find both in Kaivo's
/// notes. Needs the extension switched on and allowed, and a fresh demo page already open in Safari.
/// Skipped without TEST_RUNNER_KAIVO_MARKS. Recorded by videos/scripts/ios-duo-safari.mjs, which places the demo page:
/// the positions below are fractions of the outer display for that page's layout.
final class SafariFlowTests: XCTestCase {
    private var marks: [String] = []
    private var marksPath = ""

    private func mark(_ name: String) {
        marks.append("\(name) \(Date().timeIntervalSince1970)")
        try? marks.joined(separator: "\n").write(toFile: marksPath, atomically: true, encoding: .utf8)
    }

    private func pause(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

    @MainActor
    func testReadAndMark() throws {
        continueAfterFailure = false
        guard let path = ProcessInfo.processInfo.environment["KAIVO_FLOW_MARKS"] else { throw XCTSkip("only for the recording") }
        marksPath = path
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let page = safari.webViews.firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 60))
        func at(_ x: Double, _ y: Double) -> XCUICoordinate { safari.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)) }
        func button(_ name: String) -> XCUIElement {
            let b = safari.buttons[name].firstMatch
            XCTAssertTrue(b.waitForExistence(timeout: 15), "button \(name)")
            return b
        }
        pause(1.5)
        mark("start")
        pause(2.2)

        // a sentence: select its first word, pull the handle to its end, keep it
        mark("select")
        at(0.11, 0.465).press(forDuration: 1.0)
        pause(1.4)
        at(0.232, 0.49).press(forDuration: 0.15, thenDragTo: at(0.73, 0.49), withVelocity: .slow, thenHoldForDuration: 0.3)
        pause(1.4)
        mark("highlight")
        button("Highlight").tap()
        pause(2.2)

        // a word with a thought attached
        mark("comment")
        at(0.36, 0.717).press(forDuration: 1.0)
        pause(1.2)
        button("Highlight and comment").tap()
        pause(1.0)
        let field = safari.textViews["Comment"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let save = button("Save")
        // the very first use of a keyboard can swallow the text (its introduction): then type again
        for _ in 0..<3 where !save.isEnabled {
            field.tap()
            pause(0.6)
            field.typeText("Breakfast, now with newsletters #toast")
            pause(1.0)
        }
        XCTAssertTrue(save.isEnabled, "the comment is typed")
        save.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 10), "the comment box closes after saving")
        pause(1.8)

        // Kaivo from Safari's page menu: everything marked is in Notes
        mark("menu")
        button("MoreMenuButton").tap()
        pause(1.2)
        mark("kaivo")
        button("Kaivo").tap()
        pause(4.0)
        mark("notes")
        let notesFilter = safari.switches["Everything"].firstMatch
        // the other screens are in the page too, only off to the side: "exists" says nothing, it has to be hittable
        for y in [0.945, 0.955, 0.93, 0.945] where !(notesFilter.exists && notesFilter.isHittable) {
            at(0.67, y).tap()
            pause(2.5)
        }
        XCTAssertTrue(notesFilter.exists && notesFilter.isHittable, "Kaivo's Notes tab is open")
        pause(1.6)
        mark("list")
        at(0.4, 0.88).press(forDuration: 0.05, thenDragTo: at(0.4, 0.62), withVelocity: .slow, thenHoldForDuration: 0.1)
        pause(3.0)
        mark("end")
        pause(1.5)
    }
}
