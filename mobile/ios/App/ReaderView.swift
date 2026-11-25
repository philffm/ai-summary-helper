import SwiftUI

struct ReaderView: View {
    private enum TextSize: String, CaseIterable, Identifiable {
        case small = "Small", standard = "Default", large = "Large"   // the stored values
        var id: Self { self }
        var title: LocalizedStringKey { LocalizedStringKey(rawValue) }
        var style: UIFont.TextStyle { self == .small ? .callout : self == .large ? .title3 : .body }
    }

    let id: Article.ID
    @Environment(Library.self) private var library
    @Environment(Speaker.self) private var speaker
    @AppStorage("readerTextSize") private var textSize = TextSize.standard
    @State private var showSummary = LaunchOptions.showSummary

    var body: some View {
        Group {
            if let article = library.article(id) {
                content(article)
            } else {
                ContentUnavailableView("Article removed", systemImage: "trash")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
    }

    private func content(_ article: Article) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(verbatim: "\(article.host) · \(article.duration)").font(.footnote).foregroundStyle(.secondary)
                Text(article.title).font(.title.weight(.semibold)).fontDesign(.serif).accessibilityAddTraits(.isHeader)
                if article.passages.isEmpty {
                    Text("The text of this article is not on this device yet.").foregroundStyle(.secondary)
                }
                // lazy, so that a paragraph appearing means the reader got that far
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(article.passages.enumerated()), id: \.element.id) { index, passage in
                        paragraph(passage)
                            .onAppear { library.read(id, upTo: Double(index + 1) / Double(article.passages.count)) }
                    }
                }
                SampleNote()
            }
            .frame(maxWidth: 640, alignment: .leading)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Picker("Text size", selection: $textSize) {
                        ForEach(TextSize.allCases) { Text($0.title).tag($0) }
                    }
                } label: {
                    Label("Text size", systemImage: "textformat.size")
                }
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
                if !article.summary.isEmpty {
                    Button { showSummary = true } label: { Label("Summary", systemImage: "text.alignleft") }
                }
            }
        }
        .sheet(isPresented: $showSummary) {
            NavigationStack {
                List {
                    Section {
                        ForEach(article.summary, id: \.self) { Text($0) }
                    } footer: {
                        SampleNote()
                    }
                }
                .navigationTitle("Summary")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Done") { showSummary = false } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder
    private func paragraph(_ passage: Passage) -> some View {
        if passage.kind == .image {
            ArticleImage(source: passage.image ?? "", description: passage.text)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                PassageText(passage: passage, style: textSize.style,
                            highlight: { range in library.change(passage.id, in: id) { $0.highlight(range) } },
                            unmark: { range in library.change(passage.id, in: id) { $0.unmark(range) } })
                ForEach(passage.marks.filter(\.ai)) { suggestion in
                    HStack {
                        Text("Suggested by the AI").font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button { library.change(passage.id, in: id) { $0.resolve(suggestion: suggestion.id, keep: true) } } label: {
                            Text("Keep").foregroundStyle(Color(.systemBackground))
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Dismiss") { library.change(passage.id, in: id) { $0.resolve(suggestion: suggestion.id, keep: false) } }
                            .buttonStyle(.bordered)
                    }
                    .sensoryFeedback(.success, trigger: passage.marks.filter { !$0.ai }.count)
                }
            }
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
