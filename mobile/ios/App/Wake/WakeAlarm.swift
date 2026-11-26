import ActivityKit
import AlarmKit
import AppIntents
import SwiftUI

/// The alarm's second button: opens Kaivo on the wake screen.
@available(iOS 26.0, *)
struct PlayWakeIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Play"
    static let openAppWhenRun = true
    static let isDiscoverable = false

    @Parameter(title: "Alarm") var alarmID: String

    init() {}
    init(alarmID: String) { self.alarmID = alarmID }

    @MainActor
    func perform() async throws -> some IntentResult {
        if let id = UUID(uuidString: alarmID) { try? AlarmManager.shared.stop(id: id) }
        let settings = WakeSettings.load()
        WakeCenter.shared.playing = WakeRequest(mode: settings.mode, noBadNews: settings.noBadNews)
        return .result()
    }
}

/// Keeps the system alarm in step with the settings (AlarmKit: it rings through silent mode and Focus).
@available(iOS 26.0, *)
enum WakeAlarm {
    /// One alarm, always the same id; the test ring has its own.
    static let id = UUID(uuidString: "6C1F3B0E-7A44-4E0B-9C0D-5B6E2A1D9F10")!
    static let testID = UUID(uuidString: "6C1F3B0E-7A44-4E0B-9C0D-5B6E2A1D9F11")!

    enum Failure: Error { case notAllowed, noDays }

    static var denied: Bool { AlarmManager.shared.authorizationState == .denied }

    private static func allowed() async throws {
        var state = AlarmManager.shared.authorizationState
        if state == .notDetermined { state = try await AlarmManager.shared.requestAuthorization() }
        guard state == .authorized else { throw Failure.notAllowed }
    }

    static func apply(_ settings: WakeSettings) async throws {
        try? AlarmManager.shared.cancel(id: id)
        guard settings.enabled else { return }
        guard !settings.days.isEmpty else { throw Failure.noDays }
        try await allowed()
        let week: [Locale.Weekday] = [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
        let schedule = Alarm.Schedule.relative(.init(time: .init(hour: settings.hour, minute: settings.minute),
                                                     repeats: .weekly(settings.days.sorted().map { week[$0 - 1] })))
        try await add(id, settings: settings, schedule: schedule)
    }

    /// Rings once, a few seconds from now, with the same buttons and sound.
    static func test(_ settings: WakeSettings, in seconds: TimeInterval = 10) async throws {
        try await allowed()
        try? AlarmManager.shared.cancel(id: testID)
        try await add(testID, settings: settings, schedule: .fixed(Date.now.addingTimeInterval(seconds)))
    }

    private static func add(_ id: UUID, settings: WakeSettings, schedule: Alarm.Schedule) async throws {
        let title: LocalizedStringResource = switch settings.mode {
        case .briefing: "Your briefing is ready"
        case .article: "An article for you"
        case .remember: "Remember?"
        }
        let snooze = settings.button == .snooze
        let second = snooze ? AlarmButton(text: "Snooze", textColor: .white, systemImageName: "zzz")
            : AlarmButton(text: "Play", textColor: .white, systemImageName: "play.fill")
        let behavior: AlarmPresentation.Alert.SecondaryButtonBehavior = snooze ? .countdown : .custom
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
            alert = .init(title: title, secondaryButton: second, secondaryButtonBehavior: behavior)
        } else {
            alert = .init(title: title, stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill"),
                          secondaryButton: second, secondaryButtonBehavior: behavior)
        }
        let countdown = snooze ? AlarmPresentation.Countdown(title: "Snoozing") : nil
        let attributes = AlarmAttributes<WakeMetadata>(presentation: AlarmPresentation(alert: alert, countdown: countdown), tintColor: KaivoTokens.accent)
        let configuration = AlarmManager.AlarmConfiguration(
            countdownDuration: snooze ? .init(preAlert: nil, postAlert: TimeInterval(settings.snoozeMinutes * 60)) : nil,
            schedule: schedule,
            attributes: attributes,
            secondaryIntent: snooze ? nil : PlayWakeIntent(alarmID: id.uuidString),
            sound: settings.sound.isEmpty ? .default : .named(settings.sound))
        _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
    }
}
