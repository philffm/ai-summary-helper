import BackgroundTasks
import Foundation
import WidgetKit

/// The models the app works with: one of each, for the screens and for work the system starts while no screen is there.
@MainActor
final class AppModels {
    static let shared = AppModels()
    lazy var library = Library()
    lazy var sync: SyncModel = {
        let sync = SyncModel(library: library)
        sync.takeFeeds = { [feeds] in feeds.take(library: $0) }
        sync.giveFeeds = { [feeds] in feeds.forLibrary }
        feeds.changed = { [weak sync] in Task { await sync?.changedHere() } }
        return sync
    }()
    lazy var feeds = FeedsModel()
}

/// Now and then the system lets the app work for a moment without being opened: feeds are fetched and the library is
/// synced, so that both are current when the reader comes. The system decides when, and how often.
enum BackgroundRefresh {
    static var identifier: String { (Bundle.main.bundleIdentifier ?? "eu.byphil.kaivo") + ".refresh" }
    /// Not sooner than this after the last one.
    static let pause: TimeInterval = 3600
    /// What a sync run may take: the system gives about half a minute in all.
    static let seconds: Double = 20

    /// Asks for the next one. Where the system cannot (a simulator, "Background App Refresh" off) nothing happens.
    static func schedule(after now: Date = .now) {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = now.addingTimeInterval(pause)
        try? BGTaskScheduler.shared.submit(request)
    }

    @MainActor
    static func run(library: Library, feeds: FeedsModel, sync: SyncModel) async {
        await library.settled()
        async let fetched: Void = feeds.refresh(ifOlderThan: 15 * 60)
        await sync.fetch(seconds: seconds)
        await fetched
        // the widgets show what is new without the app having been opened
        if !LaunchOptions.samples, library.loaded {
            SharedStore.write(Snapshot.make(library: library, feeds: feeds), to: Snapshot.file)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    @MainActor
    static func run() async {
        schedule()
        let models = AppModels.shared
        await run(library: models.library, feeds: models.feeds, sync: models.sync)
    }
}
