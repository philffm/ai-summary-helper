import SwiftUI
import WidgetKit

/// System components only, so the app looks and behaves like the iPhone it runs on (Liquid Glass on iOS 26 and later).
/// Do not give bars or lists a background of their own: that switches the system material off.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var library: Library
    @State private var sync: SyncModel
    @State private var feeds = FeedsModel()
    @State private var status = ExtensionStatus()
    @State private var speaker = Speaker()
    @State private var router = Router()
    @State private var summaries = Summaries()
    @State private var questions = Questions()
    @State private var inbox = InboxWatch()
    @State private var fetching = false
    @Environment(\.horizontalSizeClass) private var width

    init() {
        let library = Library()
        _library = State(initialValue: library)
        _sync = State(initialValue: SyncModel(library: library))
    }

    var body: some View {
        @Bindable var sync = sync
        return tabs
            .environment(\.tabsStay, width == .regular)
            .environment(library)
            .environment(feeds)
            .environment(status)
            .environment(speaker)
            .environment(router)
            .environment(summaries)
            .environment(questions)
            .environment(sync)
            // a scanned library code leads straight to the screen that asks before it connects
            .sheet(isPresented: $sync.shown) {
                NavigationStack {
                    LibrarySyncView().toolbar { Button("Done") { sync.shown = false } }
                }
                .environment(sync)
            }
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
                if url.scheme == "aish-library" {
                    sync.shown = true
                    Task { await sync.read(url.absoluteString) }
                    return
                }
                if let link = DeepLink(url) { router.open(link) }
            }
            // asked for by Siri or a shortcut: acted on once the library is there
            .onChange(of: AppRequests.shared.pending, initial: true) { _, _ in answerRequest() }
            .onChange(of: library.loaded) { _, _ in answerRequest() }
            // a summary that has just been written goes to the library
            .onChange(of: summaries.running) { before, now in
                if before != nil && now == nil { Task { await sync.changedHere() } }
            }
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    status.refresh()
                    takeHandedOver()
                    Task { await sync.fetch() }
                    Task { await feeds.refresh(ifOlderThan: 15 * 60) }
                    // what arrives while the app is in front shows at once
                    inbox.start([SafariInbox.directory, SharedLinks.directory]) { takeHandedOver() }
                } else if phase == .background {
                    inbox.stop()
                    AudioPlayer.shared.note()
                }
            }
            // not before the library is read: the widgets would show an empty one
            .onChange(of: library.loaded ? snapshot : nil, initial: true) { _, value in
                guard !LaunchOptions.samples, let value else { return }
                SharedStore.write(value, to: Snapshot.file)
                WidgetCenter.shared.reloadAllTimelines()
            }
    }

    private func answerRequest() {
        guard library.loaded, let request = AppRequests.shared.pending else { return }
        AppRequests.shared.pending = nil
        switch request {
        case .continueReading:
            // the first started article, as "Today" and the widget show it
            if let article = library.articles.first(where: { $0.progress > 0 && $0.progress < 1 }) ?? library.articles.first {
                router.open(.article(article.id))
            }
        case .briefing:
            router.open(.today)
            let text = feeds.briefingText
            if !text.isEmpty && speaker.current != "briefing" { speaker.toggle("briefing", text: text, title: String(localized: "Briefing")) }
        case .continueEpisode:
            guard let (id, sound, title, show) = Self.episodeToContinue(PodcastStore.shared, feeds) else { return router.open(.today) }
            if let entry = feeds.entries.first(where: { $0.id == id }) { router.open(.item(feed: entry.feed.url, id: entry.stored.item.id)) }
            speaker.stop()
            if AudioPlayer.shared.current != id || !AudioPlayer.shared.playing { AudioPlayer.shared.toggle(id, url: sound, title: title, show: show) }
        }
    }

    /// The episode listened to last that is not finished and can still be played.
    static func episodeToContinue(_ podcasts: PodcastStore, _ feeds: FeedsModel) -> (String, URL, String, String)? {
        let entries = feeds.entries
        for id in podcasts.started {
            if let entry = entries.first(where: { $0.id == id }), let sound = entry.stored.item.audio.flatMap(URL.init(string:)) {
                return (id, sound, entry.stored.item.title, entry.feed.name)
            }
            if podcasts.file(id) != nil, let kept = podcasts.episode(id), let sound = URL(string: kept.address) { return (id, sound, kept.title, kept.show) }
        }
        return nil
    }

    /// What Safari and the share sheet have left for the app.
    private func takeHandedOver() {
        let fromSafari = library.importFromSafari()
        Task {
            if fromSafari { await sync.changedHere() }
        }
        Task {
            await library.takeShared()
            await finishShared()
        }
        feeds.importFromSafari()
    }

    /// Fetches the text of shared links, one after the other, and starts the summaries asked for with them. A page that
    /// cannot be fetched is tried again the next time the app is opened.
    private func finishShared() async {
        guard !fetching else { return }
        fetching = true
        defer { fetching = false }
        var tried: Set<Article.ID> = []
        defer { if !tried.isEmpty { Task { await sync.changedHere() } } }
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
                Tab("Notes", systemImage: "note.text", value: "notes") { NotesView() }
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
            NotesView()
                .tabItem { Label("Notes", systemImage: "note.text") }
                .tag("notes")
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
    /// `-KaivoWriteBack YES`: runs of the library also write back. For trying it against a test place.
    static var writeBack: Bool { debugValue("KaivoWriteBack") != nil }
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
