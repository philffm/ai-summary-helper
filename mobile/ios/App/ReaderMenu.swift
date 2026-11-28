import SwiftUI

/// Everything a reader can do with the open article, behind one button: the summary and its questions, how the text
/// looks, reading aloud, and the rest. The sheet leaves the article visible, and usable at half height.
struct ReaderMenu: View {
    enum Page: String, CaseIterable, Identifiable {
        case summary, text, listen, more
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self {
            case .summary: "In short"
            case .text: "Text"
            case .listen: "Listen"
            case .more: "More"
            }
        }
    }

    let article: Article
    @Binding var page: Page
    let headings: [Passage]
    let summarize: () -> Void
    /// To a passage of the article; the menu closes first.
    let go: (Passage.ID) -> Void
    /// To the passage that holds these words.
    let show: (String) -> Void
    let listen: () -> Void
    let close: () -> Void
    @State private var showServer = false
    @State private var recommending = false

    @Environment(Summaries.self) private var summaries
    @Environment(Speaker.self) private var speaker
    @Environment(\.dynamicTypeSize) private var textSize
    @AppStorage(Speaker.paceKey) private var pace = 1.0

    var body: some View {
        VStack(spacing: 8) {
            // closed like any sheet: pulled down (beside the button: a tap elsewhere)
            // the row of tabs does not grow with the text: at very large sizes a menu stands in its place
            Group {
                if textSize.isAccessibilitySize {
                    pages.pickerStyle(.menu).font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    pages.pickerStyle(.segmented)
                }
            }
            .accessibilityIdentifier("menu-pages")
            .padding(.horizontal, 12)
            .padding(.top, 22)
            switch page {
            case .summary: summary
            case .text: ReaderDisplayPanel()
            case .listen: reading
            case .more: more
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(ReaderPrompts(id: article.id, active: true, showServer: $showServer))
        .sheet(isPresented: $recommending) { RecommendView(article: article) }
    }

    private var pages: some View {
        Picker("Reader menu", selection: $page) {
            ForEach(Page.allCases) { Text($0.title).tag($0) }
        }
    }

    private var summary: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !article.passages.isEmpty || !article.summary.isEmpty {
                    SummaryCard(article: article, open: .constant(true), waiting: summaries.isWaiting(article.id),
                                step: summaries.running == article.id ? summaries.step : (0, 0),
                                again: ModelEndpoint.current != nil, plain: true, summarize: summarize)
                }
                if !article.passages.isEmpty {
                    ArticleQuestions(article: article, show: show, setUp: { showServer = true }) { now in
                        if now { proxy.keepInView(ArticleQuestions.composer) }
                    }
                } else {
                    Text("The text of this article is not on this device yet.").foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .scrollDismissesKeyboard(.interactively)
        }
    }

    private var reading: some View {
        let on = speaker.current == article.id
        return ScrollView {
            VStack(spacing: 18) {
                Button(action: listen) {
                    Image(systemName: on ? "stop.fill" : "play.fill").font(.title)
                        .frame(width: 76, height: 76)
                        .foregroundStyle(Color(.systemBackground))
                        .background(KaivoTokens.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(article.passages.isEmpty)
                .accessibilityLabel(on ? "Stop" : "Listen")
                .accessibilityIdentifier("menu-listen")
                Text(on ? "Reading aloud…" : "Read the article aloud").font(.subheadline).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Speed").font(.subheadline.weight(.semibold))
                    Picker("Speed", selection: $pace) {
                        ForEach(Speaker.paces, id: \.factor) { Text(verbatim: $0.factor.formatted() + " ×").tag($0.factor) }
                    }
                    .pickerStyle(.segmented)
                    if on { Text("A new speed applies from the next start.").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .padding(20)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var more: some View {
        List {
            if let url = article.url {
                Section {
                    Button { recommending = true } label: { Label("Recommend…", systemImage: "paperplane") }
                        .accessibilityIdentifier("recommend")
                    ShareLink(item: url, subject: Text(article.title)) { Label("Share…", systemImage: "square.and.arrow.up") }
                    Button { UIPasteboard.general.url = url; close() } label: { Label("Copy link", systemImage: "link") }
                    Link(destination: url) { Label("Open in Safari", systemImage: "safari") }
                }
            }
            if headings.count > 1 {
                Section("Contents") {
                    ForEach(headings) { heading in
                        Button { go(heading.id) } label: { Text(verbatim: heading.text).foregroundStyle(.primary) }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .tint(KaivoTokens.accent)
    }
}

extension ScrollViewProxy {
    /// Brings a field to the lower edge of what the keyboard leaves free, once the keyboard has made its room.
    func keepInView(_ id: String) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            withAnimation(.snappy) { scrollTo(id, anchor: .bottom) }
        }
    }
}

/// A round button of glass that floats over the article; before iOS 26 of blurred material.
struct FloatingGlass<S: Shape>: ViewModifier {
    let shape: S

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.background(.regularMaterial, in: shape).shadow(color: .black.opacity(0.16), radius: 10, y: 4)
        }
    }
}
