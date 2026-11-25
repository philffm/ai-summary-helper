import SwiftUI

/// Gets the Safari extension switched on and says what it does on an iPhone. Shown as a sheet.
struct SetupView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ExtensionStatus.self) private var status

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 10) {
                        Image("Logo")
                            .resizable()
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                            .accessibilityHidden(true)
                        Text(verbatim: "Kaivo").font(.largeTitle.weight(.semibold)).fontDesign(.serif)
                        Text("Go to the source. Take it with you.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
                if status.state == .on {
                    Section {
                        Label("Kaivo is on in Safari", systemImage: "checkmark.circle.fill")
                    } footer: {
                        Text("Open an article in Safari, tap the page menu in the address bar and choose Kaivo.")
                    }
                } else {
                    Section("Switch on Kaivo in Safari") {
                        Label("Open Settings → Apps → Safari → Extensions.", systemImage: "1.circle")
                        Label("Turn on Kaivo.", systemImage: "2.circle")
                        Label("Allow it on websites, then open an article and tap the page menu in the address bar.", systemImage: "3.circle")
                        if #available(iOS 26.2, *) {
                            Button("Open extension settings") { status.openSettings() }
                        }
                    }
                }
                Section("In Safari") {
                    feature("text.alignleft", "Summaries", "Articles, PDFs and videos, with the AI model you choose.")
                    feature("highlighter", "Highlights", "Mark a passage and find it again with its source.")
                    feature("books.vertical", "Library", "What you save stays on your device.")
                }
                Section {
                    if let url = URL(string: "https://kaivo.byphil.eu/privacy.html") { Link("Privacy policy", destination: url) }
                    if let url = URL(string: "https://kaivo.byphil.eu/") { Link(destination: url) { Text(verbatim: "kaivo.byphil.eu") } }
                }
            }
            .navigationTitle(Text(verbatim: "Safari"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func feature(_ symbol: String, _ title: LocalizedStringKey, _ text: LocalizedStringKey) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol)
        }
    }
}
