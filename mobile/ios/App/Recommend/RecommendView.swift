import SwiftUI
import UIKit

/// "Recommend": what goes with it is chosen here, then the system's share sheet gets the words and the file.
struct RecommendView: View {
    let article: Article
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var withMarks = true
    @State private var withSummary = false
    @State private var withName = true
    @AppStorage("recommendName") private var name = ""
    @State private var sharing: Outgoing?
    @State private var failed = false

    private struct Outgoing: Identifiable {
        let id = UUID()
        let items: [Any]
    }

    /// The reader's own marks, not the AI's suggestions.
    private var marks: [String] { article.passages.flatMap { passage in passage.marks.filter { !$0.ai }.map { passage.words(of: $0) } } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: article.title).font(.headline).fontDesign(.serif)
                        Text(verbatim: article.host).font(.footnote).foregroundStyle(.secondary)
                    }
                    TextField("Your note", text: $note, axis: .vertical).lineLimit(2...6).accessibilityIdentifier("recommend-note")
                }
                Section {
                    if !marks.isEmpty { Toggle("My highlights (\(marks.count))", isOn: $withMarks) }
                    if !article.summary.isEmpty { Toggle("Summary", isOn: $withSummary) }
                    Toggle("My name", isOn: $withName)
                    if withName {
                        TextField("Name", text: $name).textContentType(.givenName).accessibilityIdentifier("recommend-name")
                    }
                } footer: {
                    Text("The link and your note go into the message, with a file that anyone can read and Kaivo can save. No account, no id, and not the article's text.")
                }
                Section {
                    Button(action: share) {
                        Label("Share…", systemImage: "square.and.arrow.up").font(.body.weight(.semibold)).frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("recommend-share")
                }
            }
            .navigationTitle("Recommend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .sheet(item: $sharing) { ActivityView(items: $0.items) }
            .alert("The file could not be written.", isPresented: $failed) { Button("OK", role: .cancel) {} }
        }
    }

    private func share() {
        let from = withName ? name.trimmingCharacters(in: .whitespaces) : ""
        guard let url = article.url, let recommendation = Recommendation(
            url: url.absoluteString, title: article.title, note: note, from: from,
            marks: withMarks ? marks : [], summary: withSummary ? article.summary : []).checked() else { failed = true; return }
        do {
            let file = try Self.write(recommendation)
            // the words first: where an app drops them for the file, the file holds them too
            let words = [recommendation.note, url.absoluteString].filter { !$0.isEmpty }.joined(separator: "\n")
            sharing = Outgoing(items: [words, file])
        } catch {
            failed = true
        }
    }

    /// The page in a folder of its own, under a name a person understands.
    static func write(_ recommendation: Recommendation) throws -> URL {
        let by = recommendation.from.isEmpty ? String(localized: "A recommendation for you") : String(localized: "Recommended by \(recommendation.from)")
        let page = recommendation.page(.init(recommendedBy: by, read: String(localized: "Read the article"),
                                             hint: String(localized: "Open this file with Kaivo to save the article with these notes.")))
        let folder = FileManager.default.temporaryDirectory.appending(path: "recommend-" + UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = recommendation.from.isEmpty ? String(localized: "Recommendation") : String(localized: "Recommendation from \(recommendation.from)")
        let file = folder.appending(path: Recommendation.fileName(name))
        try Data(page.utf8).write(to: file, options: .atomic)
        return file
    }
}

/// The system's share sheet, which takes words and a file together.
private struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Above an article someone sent: who, and what they wrote.
struct RecommendationCard: View {
    let recommendation: Recommendation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label {
                if recommendation.from.isEmpty { Text("Recommended to you") } else { Text("Recommended by \(recommendation.from)") }
            } icon: {
                Image(systemName: "paperplane")
            }
            .font(.subheadline.weight(.semibold))
            if !recommendation.note.isEmpty { Text(verbatim: recommendation.note).font(.callout) }
            if !recommendation.summary.isEmpty {
                DisclosureGroup("Summary from the sender") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(recommendation.summary.enumerated()), id: \.offset) { Text(verbatim: $0.element).font(.callout) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.footnote.weight(.semibold))
            }
            Text("Name and words as sent, not checked.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yellow.opacity(0.14), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("recommendation-card")
    }
}
