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
    @State private var summaries = Summaries()
    @State private var fetching = false
    @Environment(\.horizontalSizeClass) private var width

    var body: some View {
        tabs
            .environment(\.tabsStay, width == .regular)
            .environment(library)
            .environment(feeds)
            .environment(status)
            .environment(speaker)
            .environment(router)
            .environment(summaries)
            .fullScreenCover(item: Binding(get: { WakeCenter.shared.playing }, set: { WakeCenter.shared.playing = $0 })) { request in
                WakePlayerView(request: request)
                    .environment(library)
                    .environment(feeds)
                    .environment(router)
            }
            .onAppear {
                #if DEBUG
                if #available(iOS 26.0, *), LaunchOptions.ring {
                    // `-KaivoRing YES`: let the alarm ring in a few seconds, without tapping through the settings
                    Task {
                        do { try await WakeAlarm.test(WakeSettings.load(), in: 20); print("KaivoRing: scheduled") }
                        catch { print("KaivoRing: \(error)") }
                    }
                }
                if LaunchOptions.wake { WakeCenter.shared.playing = WakeRequest(mode: .briefing, noBadNews: false) }
                if LaunchOptions.touches { TouchDots.install() }
                #endif
            }
            .onOpenURL { url in
                #if DEBUG
                if url.host() == "wake-preview" { WakeCenter.shared.playing = WakeRequest(mode: .briefing, noBadNews: false); return }
                #endif
                if let link = DeepLink(url) { router.open(link) }
            }
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    status.refresh()
                    library.importFromSafari()
                    library.takeShared()
                    Task { await finishShared() }
                    feeds.importFromSafari()
                    Task { await feeds.refresh(ifOlderThan: 15 * 60) }
                }
            }
            .onChange(of: snapshot, initial: true) { _, value in
                guard !LaunchOptions.samples else { return }
                SharedStore.write(value, to: Snapshot.file)
                WidgetCenter.shared.reloadAllTimelines()
            }
    }

    /// Fetches the text of shared links, one after the other, and starts the summaries asked for with them. A page that
    /// cannot be fetched is tried again the next time the app is opened.
    private func finishShared() async {
        guard !fetching else { return }
        fetching = true
        defer { fetching = false }
        var tried: Set<Article.ID> = []
        while let article = library.articles.first(where: { $0.pending != nil && !tried.contains($0.id) }) {
            tried.insert(article.id)
            if article.passages.isEmpty, let url = article.url, let page = await PageFetcher().fetch(url) {
                library.fill(article.id, with: page)
            }
            guard let now = library.article(article.id), !now.passages.isEmpty else { continue }
            if now.pending?.summary == true {
                // stays asked for until the summary is there: without a server, or after a failure, it is tried again
                if ModelEndpoint.current != nil { summaries.summarize(now.id, in: library, asking: false) }
            } else {
                library.nothingPending(now.id)
            }
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

    /// Tabs at the bottom where it is narrow; where there is room (unfolded, a tablet) the system can show them at the top
    /// or as a sidebar. They must stay reachable while a list and an article are side by side.
    @ViewBuilder
    private var tabView: some View {
        @Bindable var router = router
        if #available(iOS 18.0, *) {
            TabView(selection: $router.tab) {
                Tab("Today", systemImage: "sun.max", value: "today") { TodayView() }
                Tab("Feeds", systemImage: "dot.radiowaves.up.forward", value: "feeds") { FeedsView() }
                Tab("Library", systemImage: "books.vertical", value: "library") { LibraryView() }
            }
            .tabViewStyle(.sidebarAdaptable)
        } else {
            classicTabs
        }
    }

    private var classicTabs: some View {
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
    /// Writes the samples as real data (replacing what is there), for a demo device: widgets and highlights then work.
    static var seed: Bool { debugValue("KaivoSeed") != nil }
    static var demo: Bool { debugValue("KaivoDemo") != nil }
    static var ring: Bool { debugValue("KaivoRing") != nil }
    /// `-KaivoWake YES`: start on the screen that follows the alarm.
    static var wake: Bool { debugValue("KaivoWake") != nil }
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
