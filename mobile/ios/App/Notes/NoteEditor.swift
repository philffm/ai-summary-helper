import SwiftUI

/// Writing on a highlight, or changing a note.
struct NoteEditor: View {
    /// What is written about: a highlight's words; nil for a free note.
    let quote: String?
    let title: LocalizedStringKey
    let save: (String) -> Void
    @State private var text: String
    @Environment(\.dismiss) private var dismiss
    @FocusState private var writing: Bool

    init(quote: String?, title: LocalizedStringKey, text: String, save: @escaping (String) -> Void) {
        self.quote = quote
        self.title = title
        self.save = save
        _text = State(initialValue: text)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let quote {
                    Section {
                        Text(verbatim: quote).font(.system(.callout, design: .serif)).foregroundStyle(.secondary).lineLimit(5)
                    }
                }
                Section {
                    TextField("Add a comment…", text: $text, axis: .vertical)
                        .lineLimit(4...12)
                        .focused($writing)
                        .accessibilityIdentifier("note-text")
                } footer: {
                    Text("Words at the end that start with # become tags.")
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save(text.trimmingCharacters(in: .whitespacesAndNewlines))
                        dismiss()
                    }
                }
            }
            .onAppear { writing = true }
        }
        .presentationDetents([.medium, .large])
    }
}
