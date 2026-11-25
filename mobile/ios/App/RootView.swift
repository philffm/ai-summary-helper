import SwiftUI
import WidgetKit

/// System components only, so the app looks and behaves like the iPhone it runs on (Liquid Glass on iOS 26 and later).
/// Do not give bars or lists a background of their own: that switches the system material off.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var library = Library()
    @State private var feeds = FeedsModel()
    @State private var status = ExtensionStatus()
    @State private var speaker = Speaker()
    @State private var router = Router()

    var body: some View {
        tabs
            .environment(library)
            .environment(feeds)
            .environment(status)
            .environment(speaker)
            .environment(router)
            .onAppear {
                #if DEBUG
                if LaunchOptions.touches { TouchDots.install() }
                #endif
            }
            .onOpenURL { url in if let link = DeepLink(url) { router.open(link) } }
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    status.refresh()
                    library.importFromSafari()
                    Task { await feeds.refresh(ifOlderThan: 15 * 60) }
                }
            }
            .onChange(of: snapshot, initial: true) { _, value in
                guard !LaunchOptions.samples else { return }
                SharedStore.write(value, to: Snapshot.file)
                WidgetCenter.shared.reloadAllTimelines()
            }
    }

    @ViewBuilder
    private var tabs: some View {
        #if DEBUG
        if router.tab == "widgets" { WidgetGallery() } else { tabView }
        #else
        tabView
        #endif
    }

    private var tabView: some View {
        @Bindable var router = router
        return TabView(selection: $router.tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag("today")
            FeedsView()
                .tabItem { Label("Feeds", systemImage: "dot.radiowaves.up.forward") }
                .tag("feeds")
            LibraryView()
                .tabItem { Label("Library", systemImage: "books.vertical") }
                .tag("library")
        }
    }

    private var snapshot: Snapshot { Snapshot.make(library: library, feeds: feeds) }
}

extension Snapshot {
    @MainActor
    static func make(library: Library, feeds: FeedsModel) -> Snapshot {
        var snapshot = Snapshot()
        snapshot.headlines = feeds.newest.map {
            Headline(id: $0.id, title: $0.stored.item.title, source: $0.feed.name, link: DeepLink.item(feed: $0.feed.url, id: $0.stored.item.id).url)
        }
        // one highlight a day, the same all day
        let highlighted = library.articles.filter { $0.firstHighlight != nil }
        if !highlighted.isEmpty {
            let article = highlighted[(Calendar.current.ordinality(of: .day, in: .era, for: .now) ?? 0) % highlighted.count]
            snapshot.quote = Quote(text: article.firstHighlight ?? "", source: article.host, link: DeepLink.article(article.id).url)
        }
        if let article = library.articles.first(where: { $0.progress > 0 && $0.progress < 1 }) {
            snapshot.reading = Reading(title: article.title, source: article.host, progress: article.progress, link: DeepLink.article(article.id).url)
        }
        return snapshot
    }
}

/// Debug builds can start on a given screen, e.g. `simctl launch booted <id> -KaivoStartTab library` (for screenshots).
enum LaunchOptions {
    static var startTab: String { debugValue("KaivoStartTab") ?? "today" }
    static var startArticle: String? { debugValue("KaivoStartArticle") }
    static var showSummary: Bool { debugValue("KaivoShowSummary") != nil }
    static var touches: Bool { debugValue("KaivoTouches") != nil }
    /// App Store screenshots: samples without the "sample" notes and the setup reminder.
    static var screenshots: Bool { debugValue("KaivoScreenshots") != nil }
    /// Made-up feeds and articles instead of the real ones (never in a release build).
    static var samples: Bool { screenshots || debugValue("KaivoSamples") != nil }

    private static func debugValue(_ key: String) -> String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: key)
        #else
        nil
        #endif
    }
}
