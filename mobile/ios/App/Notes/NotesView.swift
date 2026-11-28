import SwiftUI

/// "Notes": notes, the reader's highlights and the AI's, and the questions saved to the notes, newest first.
struct NotesView: View {
    @Environment(Library.self) private var library
    @Environment(Router.self) private var router
    @Environment(SyncModel.self) private var sync
    @State private var filter = NoteItem.Filter.all
    @State private var draft = ""
    @State private var editing: NoteItem?
    @FocusState private var writing: Bool

    private var shown: [NoteItem] { library.entries.filter { filter.holds($0.kind) } }

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.notesPath) {
            List {
                Section {
                    chips.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                ForEach(NoteItem.days(shown), id: \.day) { day in
                    Section {
                        ForEach(day.items) { row($0) }
                    } header: {
                        // "today" starts a line here
                        Text(verbatim: Self.heading(Dates.relativeDay(day.day))).textCase(nil)
                    }
                }
                if shown.isEmpty && library.loaded {
                    ContentUnavailableView("No notes yet", systemImage: "note.text",
                                           description: Text("Highlights, notes and saved questions appear here."))
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Notes")
            .toolbar { SyncToolbar(sync: sync) }
            .safeAreaInset(edge: .bottom) { composer }
            .routes()
            .sheet(item: $editing) { item in
                NoteEditor(quote: item.isHighlight ? item.text : nil, title: item.isHighlight ? "Comment" : "Note", text: item.written) {
                    library.write($0, on: item)
                }
            }
        }
    }

    private static func heading(_ words: String) -> String { words.prefix(1).localizedUppercase + words.dropFirst() }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(NoteItem.Filter.allCases) { choice in
                    Button { filter = choice } label: {
                        name(choice).font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .foregroundStyle(filter == choice ? Color(.systemBackground) : .primary)
                            .background(filter == choice ? KaivoTokens.accent : Color(.secondarySystemGroupedBackground), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(filter == choice ? .isSelected : [])
                }
            }
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
    }

    private func name(_ choice: NoteItem.Filter) -> Text {
        switch choice {
        case .all: Text("All")
        case .mine: Text("Mine")
        case .ai: Text("AI")
        case .notes: Text("Notes")
        }
    }

    private func row(_ item: NoteItem) -> some View {
        NoteRow(item: item,
                open: item.article.flatMap { library.article($0) }.map { article in { router.notesPath.append(.article(article.id)) } },
                keep: { library.keep(item) }, dismiss: { library.delete(item) })
            .swipeActions {
                if item.kind != .question {
                    Button("Delete", systemImage: "trash", role: .destructive) { library.delete(item) }
                } else if let article = item.article {
                    // the question stays with its article; it only leaves the notes
                    Button("Remove from notes", systemImage: "minus.circle") { library.setQuestion(article, turn: item.id, noted: false) }
                }
            }
            .contextMenu {
                if item.kind == .note {
                    Button("Edit", systemImage: "pencil") { editing = item }
                } else if item.isHighlight {
                    Button("Comment", systemImage: "text.bubble") { editing = item }
                }
                if item.kind != .question {
                    Button("Delete", systemImage: "trash", role: .destructive) { library.delete(item) }
                }
            }
    }

    /// Writing a note, where the thumb is.
    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Write a note … #tags", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($writing)
                .padding(.vertical, 8)
                .accessibilityIdentifier("composer")
            Button {
                library.addNote(draft)
                draft = ""
                writing = false
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title)
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel("Save note")
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
        .modifier(ComposerGround())
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}

private struct ComposerGround: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }
}

struct NoteRow: View {
    let item: NoteItem
    /// To the article, where it is in the app.
    let open: (() -> Void)?
    let keep: () -> Void
    let dismiss: () -> Void

    /// A word that can be tapped over a finger's height.
    private func target(_ title: LocalizedStringKey) -> some View {
        Text(title).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                kind.font(.footnote.weight(.semibold)).foregroundStyle(tint)
                if item.here == true { Text("Only on this iPhone").font(.footnote).foregroundStyle(.secondary) }
            }
            if item.isHighlight {
                Text(verbatim: item.text)
                    .font(.system(.body, design: .serif))
                    .foregroundStyle(item.kind == .ghost ? KaivoTokens.savedNoteGhostFg : KaivoTokens.savedNoteUserFg)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(item.kind == .ghost ? KaivoTokens.savedNoteGhostBg : KaivoTokens.savedNoteUserBg)
            } else {
                Text(verbatim: item.text).font(item.kind == .question ? .headline : .body)
            }
            if let answer = item.answer { Text(Self.marked(answer)).font(.callout) }
            if let quote = item.quote, !quote.isEmpty {
                Text(verbatim: quote).font(.system(.footnote, design: .serif)).foregroundStyle(.secondary)
            }
            if let comment = item.comment, !comment.isEmpty {
                Divider()
                Text(verbatim: comment).font(.callout)
            }
            if let tags = item.tags, !tags.isEmpty {
                Text(verbatim: tags.map { "#" + $0 }.joined(separator: " ")).font(.footnote).foregroundStyle(KaivoTokens.accent)
            }
            if let title = item.title, let open {
                Button(action: open) {
                    Label { Text(verbatim: title).lineLimit(1) } icon: { Image(systemName: "doc.text") }
                        .font(.footnote).frame(minHeight: 32)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }
            if item.kind == .ghost {
                HStack(spacing: 20) {
                    Button(action: keep) { target("Keep").fontWeight(.semibold) }
                    Button(action: dismiss) { target("Dismiss").foregroundStyle(.secondary) }
                }
                .buttonStyle(.borderless)
                .font(.subheadline)
            }
        }
        .padding(.vertical, 4)
    }

    private var kind: Label<Text, Image> {
        switch item.kind {
        case .note: Label("Note", systemImage: "note.text")
        case .user: Label("Your highlight", systemImage: "highlighter")
        case .ghost: Label("AI highlight", systemImage: "sparkles")
        case .question: Label("Question", systemImage: "questionmark.bubble")
        }
    }

    private var tint: Color {
        switch item.kind {
        case .user: KaivoTokens.savedNoteUserFg
        case .ghost: KaivoTokens.savedNoteGhostFg
        case .note, .question: KaivoTokens.accent
        }
    }

    /// Bold and italic as written; nothing in it can be tapped.
    static func marked(_ answer: String) -> AttributedString {
        // the points of a list stay lines; their sign becomes a bullet
        let answer = answer.replacingOccurrences(of: "(?m)^\\s*[-*]\\s+", with: "• ", options: .regularExpression)
        var text = (try? AttributedString(markdown: answer, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(answer)
        for run in text.runs where run.link != nil { text[run.range].link = nil }
        return text
    }
}
