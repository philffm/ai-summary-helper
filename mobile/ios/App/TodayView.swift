import SwiftUI

struct TodayView: View {
    @Environment(Library.self) private var library
    @Environment(FeedsModel.self) private var feeds
    @Environment(ExtensionStatus.self) private var status
    @Environment(Speaker.self) private var speaker
    @Environment(Router.self) private var router
    @State private var showSetup = false
    @State private var showWake = false
    @Environment(\.horizontalSizeClass) private var width

    private var briefing: [FeedEntry] { Array(feeds.newest.prefix(3)) }
    private var started: [Article] { library.articles.filter { $0.progress > 0 && $0.progress < 1 } }
    private var remembered: Article? { library.articles.first { $0.firstHighlight != nil } }

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.todayPath) {
            Group {
                // wide: what is new on one side, what you are in the middle of on the other
                if width == .regular && (!started.isEmpty || remembered != nil) {
                    TwoParts {
                        List { new }.contentMargins(.trailing, Gutter.half, for: .scrollContent)   // only towards the middle: outside
                    } second: {
                        List { yours }.contentMargins(.leading, Gutter.half, for: .scrollContent)   // the system keeps clear of its bars
                    }
                    .background(Color(.systemGroupedBackground))
                } else {
                    List {
                        new
                        yours
                    }
                }
            }
            .navigationTitle("Today")
            .routes()
            .refreshable { await feeds.refresh() }
            .toolbar {
                // the wake alarm needs the system's alarm service of iOS 26
                if #available(iOS 26.0, *) {
                    Button { showWake = true } label: { Label("Wake", systemImage: "alarm") }
                }
                Button { showSetup = true } label: { Label("Safari extension", systemImage: "safari") }
            }
            .sheet(isPresented: $showSetup) { SetupView() }
            .sheet(isPresented: $showWake) {
                if #available(iOS 26.0, *) { WakeView() }
            }
        }
    }

    /// The setup hint, and the briefing.
    @ViewBuilder
    private var new: some View {
        if status.state != .on && !LaunchOptions.screenshots && !LaunchOptions.touches {
            Section {
                Button { showSetup = true } label: {
                    Label("Switch on Kaivo in Safari", systemImage: "puzzlepiece.extension")
                }
            }
        }
        if feeds.feeds.isEmpty {
            Section {
                Button { router.tab = "feeds" } label: {
                    Label("Choose your first feeds", systemImage: "dot.radiowaves.up.forward")
                }
            } footer: {
                Text("Your briefing is made from the feeds you follow.")
            }
        }
        if !briefing.isEmpty {
            Section("Briefing") {
                ForEach(briefing) { entry in
                    NavigationLink(value: Route.item(feed: entry.feed.url, id: entry.stored.item.id)) { EntryRow(entry: entry) }
                }
                Button {
                    speaker.toggle("briefing", text: briefing.map { String(localized: "\($0.stored.item.title). From \($0.feed.name).") }.joined(separator: " "))
                } label: {
                    if speaker.current == "briefing" {
                        Label("Stop", systemImage: "stop.fill")
                    } else {
                        Label("Listen", systemImage: "play.fill")
                    }
                }
            }
        }
    }

    /// What was started, and a highlight worth remembering.
    @ViewBuilder
    private var yours: some View {
        if !started.isEmpty {
            Section("Continue reading") {
                ForEach(started) { article in
                    NavigationLink(value: Route.article(article.id)) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(verbatim: article.title).font(.body.weight(.medium)).fontDesign(.serif)
                            ProgressView(value: article.progress)
                            Text("\(article.durationLeft) left").font(.footnote).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        if let article = remembered, let words = article.firstHighlight {
            Section {
                NavigationLink(value: Route.article(article.id)) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: "“\(words)”").font(.title3).fontDesign(.serif).italic()
                        Text(verbatim: "\(article.host) · \(article.age)").font(.footnote)
                    }
                    .foregroundStyle(KaivoTokens.savedNoteUserFg)
                    .accessibilityElement(children: .combine)
                }
                .listRowBackground(KaivoTokens.savedNoteUserBg)
            } header: {
                Text("Worth remembering")
            } footer: {
                SampleNote()
            }
        }
    }
}
