import Foundation

/// The alarm as set by the reader, in `wake.json` in the shared folder.
struct WakeSettings: Codable, Equatable {
    /// Which button the alarm shows beside Stop: the system allows only one.
    enum Button: String, Codable, CaseIterable, Identifiable {
        case play, snooze
        var id: String { rawValue }
    }

    var enabled = false
    var hour = 7
    var minute = 0
    /// 1 = Monday … 7 = Sunday.
    var days: Set<Int> = [1, 2, 3, 4, 5]
    var mode = WakeMode.briefing
    var button = Button.play
    var snoozeMinutes = 10
    var noBadNews = false
    /// A file name in the app or in Library/Sounds; empty = the system's alarm sound.
    var sound = ""

    private static let file = "wake.json"
    private static let memoFile = "recall.json"
    static func load() -> WakeSettings { SharedStore.read(WakeSettings.self, from: file) ?? WakeSettings() }
    func save() { SharedStore.write(self, to: Self.file) }
    static func memos() -> [String: Memo] { SharedStore.read([String: Memo].self, from: memoFile) ?? [:] }
    static func remember(_ key: String, knew: Bool) {
        var all = memos()
        all[key] = Recall.answer(all[key], knew: knew, day: Recall.today())
        SharedStore.write(all, to: memoFile)
    }
}
