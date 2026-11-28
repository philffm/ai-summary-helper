import AppIntents
import Foundation
import Observation

/// What Siri, the Shortcuts app, Spotlight and the action button can ask of Kaivo. The app acts on a request once it is
/// in front and its library is read.
@MainActor
@Observable
final class AppRequests {
    static let shared = AppRequests()

    enum Request: Equatable { case continueReading, briefing, continueEpisode }

    var pending: Request?
}

struct SaveLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Save link"
    static let description = IntentDescription("Saves a web page to your Kaivo library. The text is fetched the next time you open Kaivo.")

    @Parameter(title: "Link") var link: URL

    static var parameterSummary: some ParameterSummary { Summary("Save \(\.$link) to Kaivo") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard SharedStore.isShared, SharedLinks.isWeb(link),
              SharedLinks.add(SharedLink(url: link.absoluteString, title: "", summarize: false, date: .now)) else {
            return .result(dialog: "That is not a web address Kaivo can save.")
        }
        return .result(dialog: "Saved to Kaivo.")
    }
}

struct ContinueReadingIntent: AppIntent {
    static let title: LocalizedStringResource = "Continue reading"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.pending = .continueReading
        return .result()
    }
}

struct PlayBriefingIntent: AppIntent {
    static let title: LocalizedStringResource = "Play briefing"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.pending = .briefing
        return .result()
    }
}

struct ContinueEpisodeIntent: AppIntent {
    static let title: LocalizedStringResource = "Continue episode"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.pending = .continueEpisode
        return .result()
    }
}

struct KaivoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ContinueReadingIntent(), phrases: ["Continue reading in \(.applicationName)"],
                    shortTitle: "Continue reading", systemImageName: "book")
        AppShortcut(intent: PlayBriefingIntent(), phrases: ["Play my \(.applicationName) briefing"],
                    shortTitle: "Play briefing", systemImageName: "play.circle")
        AppShortcut(intent: ContinueEpisodeIntent(), phrases: ["Continue my episode in \(.applicationName)"],
                    shortTitle: "Continue episode", systemImageName: "headphones")
        AppShortcut(intent: SaveLinkIntent(), phrases: ["Save a link to \(.applicationName)"],
                    shortTitle: "Save link", systemImageName: "bookmark")
    }
}
