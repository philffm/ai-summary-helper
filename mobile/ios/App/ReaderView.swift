import SwiftUI

struct ReaderView: View {
    let id: Article.ID
    @Environment(Library.self) private var library
    @Environment(Speaker.self) private var speaker
    @Environment(\.scenePhase) private var scenePhase
    @Environment(Summaries.self) private var summaries
    @State private var showReferences = false
    @State private var showServer = false
    private var stored = StoredReaderLook()
    @Environment(\.dynamicTypeSize) private var systemTextSize
    @State private var summaryOpen = LaunchOptions.showSummary
    /// Where the reader was before jumping to the summary.
    @State private var returnTo: Return?
    @State private var position = ReadingPosition()
    @State private var height: CGFloat = 0
    /// Jumping along the rail is not reading: until then, paragraphs coming into view do not count.
    @State private var jumpedAt = Date.distantPast

    init(id: Article.ID) { self.id = id }

    private struct Return: Equatable {
        var passage: Passage.ID
        var percent: Double
    }
    private static let summaryAnchor = "summary"

    var body: some View {
        Group {
            // until the library is read, an article without text is one whose text is still on its way
            if let article = library.article(id), library.loaded || !article.passages.isEmpty {
                content(article)
            } else if !library.loaded {
                ProgressView()
            } else {
                ContentUnavailableView("Article removed", systemImage: "trash")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .readingFullScreen()
    }

    private func content(_ article: Article) -> some View {
        let paper = PaperSense.isPaper(article)
        let look = stored.look
        let abstract = paper ? PaperSense.abstract(article.passages) : nil
        // a paper's list of sources stays folded until asked for; the rail and the progress count only what is on screen
        let references = paper ? PaperSense.references(article.passages) : nil
        let folded = showReferences ? nil : references
        let shown = article.passages.enumerated().filter { !(folded?.contains($0.offset) ?? false) }.map(\.element)
        let spots = DepthTrack.spots(shown)
        let headings = article.passages.filter { $0.heading != nil }
        return ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(verbatim: "\(article.host) · \(article.duration)").font(.footnote).foregroundStyle(.secondary)
                Text(article.title).readerText(look, title: true).accessibilityAddTraits(.isHeader)
                if paper { PaperHead(paper: article.paper, link: article.link) }
                if !article.passages.isEmpty || !article.summary.isEmpty {
                    SummaryCard(article: article, open: $summaryOpen, waiting: summaries.isWaiting(article.id),
                                step: summaries.running == article.id ? summaries.step : (0, 0),
                                again: ModelEndpoint.current != nil) { summarize(article.id) }
                        .id(Self.summaryAnchor)
                }
                if article.passages.isEmpty {
                    Text("The text of this article is not on this device yet.").foregroundStyle(.secondary)
                    if let url = article.url { Link(destination: url) { Label("Read the full article in Safari", systemImage: "safari") } }
                }
                // lazy, so that a paragraph appearing means the reader got that far
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, passage in
                        let at = article.passages.firstIndex { $0.id == passage.id } ?? index
                        paragraph(passage, look: look, paper: paper, small: references?.contains(at) ?? false, hint: shown.first { $0.marks.contains(where: \.ai) }?.id)
                            .modifier(AbstractBox(on: abstract?.contains(at) ?? false))
                            .id(passage.id)
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("reader")) } action: { frame in
                                position.frames[index] = frame
                                position.update(shown, height: height)
                            }
                            .onAppear {
                                guard Date.now.timeIntervalSince(jumpedAt) > 1.5 else { return }
                                // scrolled back there by hand: the way back is not needed any more
                                if returnTo?.passage == passage.id { returnTo = nil }
                                position.reach(Double(index + 1) / Double(shown.count)) { library.read(id, upTo: $0) }
                            }
                            .onDisappear { position.frames[index] = nil }
                    }
                }
                if let references {
                    Button { showReferences.toggle() } label: {
                        if showReferences {
                            Label("Hide the references", systemImage: "chevron.up")
                        } else {
                            Label("Show the references (\(references.count))", systemImage: "chevron.down")
                        }
                    }
                    .buttonStyle(.bordered)
                }
                SampleNote()
            }
            .frame(maxWidth: 640, alignment: .leading)
            .padding(20)
            .padding(.trailing, spots.isEmpty ? 0 : 14)   // room for the rail
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(spots.isEmpty ? .automatic : .hidden)   // the rail shows the position
        .coordinateSpace(.named("reader"))
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { value in
            height = value
            position.update(shown, height: value)
        }
        .overlay(alignment: .trailing) {
            if !spots.isEmpty {
                DepthRail(spots: spots, position: position) { spot in
                    jumpedAt = .now
                    withAnimation(.snappy) { proxy.scrollTo(spot.passage, anchor: .center) }
                } seek: { fraction in
                    jumpedAt = .now
                    if let i = DepthTrack.index(shown, at: fraction) { proxy.scrollTo(shown[i].id, anchor: .top) }
                }
                .padding(.vertical, 24)
                .padding(.trailing, 2)
            }
        }
        .overlay(alignment: .bottom) {
            if let back = returnTo {
                Button {
                    jumpedAt = .now
                    returnTo = nil
                    withAnimation(.snappy) { proxy.scrollTo(back.passage, anchor: .top) }
                } label: {
                    Label("Back to where you were · \(back.percent.formatted(.percent.precision(.fractionLength(0))))", systemImage: "arrow.down")
                        .font(.subheadline.weight(.semibold))
                }
                .modifier(FloatingAction())
                .padding(.bottom, 8)
            }
        }
        .readerPage(look.ground)
        .onDisappear { position.settle { library.read(id, upTo: $0) } }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { position.settle { library.read(id, upTo: $0) } }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if headings.count > 1 {
                    Menu {
                        ForEach(headings) { heading in
                            Button { go(to: heading.id, with: proxy) } label: { Text(verbatim: heading.text) }
                        }
                    } label: {
                        Label("Contents", systemImage: "list.bullet")
                    }
                }
                ReaderDisplayButton()
                if let url = article.url { ShareLink(item: url, subject: Text(article.title)) }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    speaker.toggle(article.id, text: ([article.title] + article.passages.filter { $0.kind != .image }.map(\.text)).joined(separator: " "))
                } label: {
                    if speaker.current == article.id {
                        Label("Stop", systemImage: "stop.fill")
                    } else {
                        Label("Listen", systemImage: "headphones")
                    }
                }
                Spacer()
                if !article.passages.isEmpty || !article.summary.isEmpty {
                    Button {
                        showSummary(of: article, shown: shown, with: proxy)
                    } label: {
                        // a bar shows a label's picture only: the word is wanted with it
                        HStack(spacing: 6) {
                            Image(systemName: "sparkles")
                            Text("In short").fontWeight(.semibold)
                        }
                    }
                    .accessibilityLabel("In short")
                    .accessibilityIdentifier("summary-jump")
                }
            }
        }
        .sheet(isPresented: $showServer) { NavigationStack { ModelServerView(closable: true) } }
        .alert("Send text to an AI service?",
               isPresented: Binding(get: { summaries.question?.article == article.id }, set: { if !$0 { summaries.question = nil } }),
               presenting: summaries.question) { question in
            Button("Allow") { summaries.answer(question, allow: true, in: library) }
            Button("Not now", role: .cancel) { summaries.answer(question, allow: false, in: library) }
        } message: { question in
            Text("To write the summary, Kaivo sends the text of this article to \(question.endpoint.recipient). Nothing is sent before you allow it.")
        }
        // a summary asked for while sharing waits for the yes until the article is looked at
        .task(id: article.passages.isEmpty) {
            if article.pending?.summary == true && article.summary.isEmpty && !article.passages.isEmpty, ModelEndpoint.current != nil {
                summaries.summarize(article.id, in: library)
            }
        }
        .alert("No summary", isPresented: Binding(get: { summaries.failure != nil }, set: { if !$0 { summaries.failure = nil } })) {
            Button("Model") { showServer = true }
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: summaries.failure ?? "")
        }
        }
    }

    /// To the summary at the top, unfolded; one is written first where there is none. Whoever was further down gets the
    /// way back.
    private func showSummary(of article: Article, shown: [Passage], with proxy: ScrollViewProxy) {
        if article.summary.isEmpty && !summaries.isWaiting(article.id) { summarize(article.id) }
        if let index = position.top(height: height), index > 0, shown.indices.contains(index) {
            returnTo = Return(passage: shown[index].id, percent: position.window.lowerBound)
        }
        jumpedAt = .now
        withAnimation(.snappy) {
            summaryOpen = true
            proxy.scrollTo(Self.summaryAnchor, anchor: .top)
        }
    }

    private func summarize(_ id: Article.ID) {
        if ModelEndpoint.current != nil { summaries.summarize(id, in: library) } else { showServer = true }
    }

    /// From the contents: a heading among the references unfolds them first.
    private func go(to passage: Passage.ID, with proxy: ScrollViewProxy) {
        jumpedAt = .now
        showReferences = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(60))
            withAnimation(.snappy) { proxy.scrollTo(passage, anchor: .top) }
        }
    }

    private func style(of passage: Passage, small: Bool) -> UIFont.TextStyle {
        if let level = passage.heading { return level == 1 ? .title2 : level == 2 ? .title3 : .headline }
        return small ? .footnote : .body
    }

    @ViewBuilder
    private func paragraph(_ passage: Passage, look: ReaderLook, paper: Bool, small: Bool, hint: Passage.ID?) -> some View {
        if passage.kind == .image {
            ArticleImage(source: passage.image ?? "", description: passage.text)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                PassageText(passage: passage, style: style(of: passage, small: small), look: look, textSize: systemTextSize,
                            citations: paper && !small,
                            highlight: { range in library.change(passage.id, in: id) { $0.highlight(range) } },
                            unmark: { range in library.change(passage.id, in: id) { $0.unmark(range) } },
                            resolve: { mark, keep in library.change(passage.id, in: id) { $0.resolve(suggestion: mark, keep: keep) } })
                // said once, at the first suggestion: the actions are behind a tap
                if passage.id == hint {
                    Text("Tap a suggestion of the AI to keep or dismiss it.").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Who wrote a paper, where it appeared, and its permanent address.
struct PaperHead: View {
    let paper: Paper?
    let link: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Research article", systemImage: "graduationcap").font(.footnote.weight(.semibold)).foregroundStyle(KaivoTokens.accent)
            if let authors = paper?.authors, !authors.isEmpty {
                Text(verbatim: authors.prefix(6).joined(separator: ", ") + (authors.count > 6 ? " …" : "")).font(.subheadline)
            }
            if let journal = paper?.journal, !journal.isEmpty { Text(verbatim: journal).font(.subheadline.italic()).foregroundStyle(.secondary) }
            let doi = paper.map(\.doi).flatMap { $0.isEmpty ? nil : $0 } ?? PaperSense.doi(in: link)
            if let doi, let url = URL(string: "https://doi.org/" + doi) {
                Link(destination: url) { Text(verbatim: "doi.org/" + doi).font(.footnote) }
            }
        }
    }
}

/// The abstract stands on its own ground.
private struct AbstractBox: ViewModifier {
    let on: Bool

    func body(content: Content) -> some View {
        if on {
            content.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(KaivoTokens.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            content
        }
    }
}

/// A picture of an article: saved with it, or loaded from its https address.
struct ArticleImage: View {
    let source: String
    let description: String

    var body: some View {
        Group {
            if source.hasPrefix("https://") {
                AsyncImage(url: URL(string: source)) { phase in
                    if let image = phase.image {
                        shaped(image)
                    } else if phase.error == nil {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                    }
                }
            } else if let picture = UIImage(contentsOfFile: SharedStore.directory.appending(path: source).path) {
                shaped(Image(uiImage: picture))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: description))
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(description.isEmpty)
    }

    private func shaped(_ image: Image) -> some View {
        image.resizable().scaledToFit()
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A button that floats over the article: Liquid Glass from iOS 26 on.
private struct FloatingAction: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glass)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
