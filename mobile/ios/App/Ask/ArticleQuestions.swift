import SwiftUI

/// Under the summary: what was asked about the article, the questions a model has prepared, and the field to ask more.
/// An answer is folded to its question unless it is shown with the summary, was just given, or has been opened.
struct ArticleQuestions: View {
    let article: Article
    /// To the passage an answer rests on.
    let show: (String) -> Void
    /// There is no model to ask.
    let setUp: () -> Void
    /// The field is being written in (or no longer is): the page around it keeps it in view.
    var typing: (Bool) -> Void = { _ in }
    /// The field and its arrow, to scroll to.
    static let composer = "ask-composer"

    @Environment(Questions.self) private var questions
    @Environment(Library.self) private var library
    @State private var draft = ""
    /// Answers opened or folded by hand.
    @State private var toggled: Set<String> = []
    @FocusState private var writing: Bool

    private var waiting: Questions.Asking? { questions.asking[article.id] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(article.questions ?? []) { turn($0) }
            if let waiting {
                // a continued answer stands above already
                if waiting.turn == nil { bubble(waiting.question) }
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Thinking…").font(.footnote).foregroundStyle(.secondary)
                }
                .frame(minHeight: 36)
                .accessibilityElement(children: .combine)
            } else {
                ForEach(ideas, id: \.self) { idea in
                    Button { send(idea) } label: {
                        Text(verbatim: idea).font(.subheadline).multilineTextAlignment(.leading)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .frame(minHeight: 40)
                            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay { RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(KaivoTokens.accent.opacity(0.25)) }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(KaivoTokens.accent)
                    .accessibilityIdentifier("idea")
                }
            }
            if questions.cut.contains(article.id) {
                Text("The article is long: the answer comes from its beginning.").font(.footnote).foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 6) {
                TextField("Ask about this article…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($writing)
                    .submitLabel(.send)
                    .padding(.vertical, 10)
                    .accessibilityIdentifier("ask-field")
                Button { send(draft) } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
                    .buttonStyle(.plain)
                    .foregroundStyle(canSend ? AnyShapeStyle(KaivoTokens.accent) : AnyShapeStyle(.tertiary))
                    .disabled(!canSend)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Ask")
            }
            .padding(.leading, 14)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color(.separator)) }
            .id(Self.composer)
        }
        .tint(KaivoTokens.accent)
        .onChange(of: writing) { _, now in typing(now) }
        // a question of several lines grows downwards, behind the keyboard
        .onChange(of: draft) { _, _ in if writing { typing(true) } }
        .onDisappear { if writing { typing(false) } }
    }

    /// What the model prepared; two plain ones where there is nothing yet.
    private var ideas: [String] {
        let prepared = article.openSuggestions.map(\.question)
        if !prepared.isEmpty || !(article.questions ?? []).isEmpty { return prepared }
        return [String(localized: "What are the key points?"), String(localized: "Who is this for, and what does it assume?")]
    }

    private func isOpen(_ question: Question) -> Bool {
        (question.pinned == true || questions.latest[article.id] == question.id) != toggled.contains(question.id)
    }

    private var canSend: Bool { waiting == nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send(_ text: String, more turn: String? = nil) {
        guard questions.send(text, about: article.id, in: library, turn: turn) else { return setUp() }
        if text == draft { draft = "" }
        writing = false
    }

    /// `open`: whether its answer shows; nil for a question that has none yet.
    private func bubble(_ text: String, open: Bool? = nil) -> some View {
        HStack {
            Spacer(minLength: 40)
            HStack(spacing: 8) {
                Text(verbatim: text).font(.callout).multilineTextAlignment(.leading)
                if let open { Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption.weight(.bold)).accessibilityHidden(true) }
            }
                .padding(.horizontal, 14).padding(.vertical, 9)
                .foregroundStyle(Color(.systemBackground))
                .background(KaivoTokens.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private func turn(_ question: Question) -> some View {
        let open = isOpen(question)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { _ = toggled.remove(question.id) ?? toggled.insert(question.id).memberAfterInsert }
            } label: { bubble(question.question, open: open) }
                .buttonStyle(.plain)
                .accessibilityValue(open ? Text("Expanded") : Text("Collapsed"))
            if open { answer(question) }
        }
    }

    private func answer(_ question: Question) -> some View {
            VStack(alignment: .leading, spacing: 8) {
                Text(NoteRow.marked(question.answer)).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                ForEach(question.sources ?? [], id: \.self) { source in
                    Button { show(source) } label: {
                        Label { Text(verbatim: source).lineLimit(1) } icon: { Image(systemName: "paragraphsign") }
                            .font(.footnote).frame(minHeight: 32)
                    }
                    .buttonStyle(.borderless)
                }
                if questions.short[article.id] == question.id && waiting == nil {
                    Button { send(question.question, more: question.id) } label: {
                        Label("Dig deeper", systemImage: "arrow.down.right.circle").font(.footnote.weight(.semibold)).frame(minHeight: 36)
                    }
                    .buttonStyle(.bordered)
                }
                HStack(spacing: 16) {
                    Spacer()
                    toggle(question.pinned == true, on: "In article", off: "Add to article", symbol: "pin") {
                        library.setQuestion(article.id, turn: question.id, pinned: question.pinned != true)
                    }
                    toggle(question.noted == true, on: "In notes", off: "Save to notes", symbol: "note.text") {
                        library.setQuestion(article.id, turn: question.id, noted: question.noted != true)
                    }
                }
            }
            .padding(12)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color(.separator).opacity(0.6)) }
    }

    private func toggle(_ isOn: Bool, on: LocalizedStringKey, off: LocalizedStringKey, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(isOn ? on : off, systemImage: isOn ? "checkmark" : symbol).font(.footnote.weight(.semibold)).frame(minHeight: 32)
        }
        .buttonStyle(.borderless)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
