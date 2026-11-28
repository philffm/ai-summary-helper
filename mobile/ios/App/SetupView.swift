import SwiftUI

/// "Settings": the synced library first, then the model, then Kaivo in Safari. Shown as a sheet.
struct SettingsView: View {
    enum Page: Hashable { case sync, model, safari, storage }

    @Environment(\.dismiss) private var dismiss
    @Environment(ExtensionStatus.self) private var status
    @Environment(SyncModel.self) private var sync
    @State private var path: [Page]
    @State private var welcoming = false

    /// `start`: a page to open right away, as if its row had been tapped.
    init(start: Page? = nil) { _path = State(initialValue: start.map { [$0] } ?? []) }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NavigationLink(value: Page.sync) {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Sync")
                                syncLine.font(.footnote).foregroundStyle(.secondary)
                            }
                        } icon: {
                            SyncGlyph()
                        }
                    }
                    .accessibilityIdentifier("settings-sync")
                    NavigationLink(value: Page.model) { Label("Model for summaries", systemImage: "cpu") }
                    NavigationLink(value: Page.storage) {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Storage")
                                Text(verbatim: PodcastStore.shared.totalBytes.fileSize).font(.footnote).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "internaldrive")
                        }
                    }
                    .accessibilityIdentifier("settings-storage")
                }
                Section {
                    NavigationLink(value: Page.safari) {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Kaivo in Safari")
                                // only said where the system can tell
                                switch status.state {
                                case .on: Text("Switched on").font(.footnote).foregroundStyle(.secondary)
                                case .off: Text("Not switched on").font(.footnote).foregroundStyle(.secondary)
                                case .unknown: EmptyView()
                                }
                            }
                        } icon: {
                            Image(systemName: "safari")
                        }
                    }
                }
                Section {
                    Button { welcoming = true } label: { Label("How to start", systemImage: "questionmark.circle") }
                        .accessibilityIdentifier("settings-welcome")
                }
                Section {
                    Text("Delete your account in Kaivo in Safari: More → Settings → Account.").font(.footnote)
                } header: {
                    Text("Your account")
                }
                Section {
                    if let url = URL(string: "https://kaivo.byphil.eu/privacy.html") { Link("Privacy policy", destination: url) }
                    if let url = URL(string: "https://kaivo.byphil.eu/") {
                        Link(destination: url) { Text(verbatim: "kaivo.byphil.eu") }.accessibilityLabel("Kaivo website")
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .navigationDestination(for: Page.self) { page in
                switch page {
                case .sync: LibrarySyncView()
                case .model: ModelServerView()
                case .safari: SafariSetupView()
                case .storage: StorageView()
                }
            }
            .task { await sync.refresh() }
            .sheet(isPresented: $welcoming) { WelcomeView().environment(status) }
        }
    }

    @ViewBuilder
    private var syncLine: some View {
        if let progress = sync.progress, sync.running, progress.total > 0 {
            Text("\(String(progress.done)) of \(String(progress.total)) entries")
        } else if sync.running {
            Text("Syncing")
        } else if sync.failed {
            Text("Last sync failed")
        } else if let state = sync.state {
            Text(verbatim: [state.server, state.root].compactMap { $0 }.joined(separator: " · "))
        }
    }
}

/// Gets the Safari extension switched on and says what it does on an iPhone.
struct SafariSetupView: View {
    @Environment(ExtensionStatus.self) private var status

    var body: some View {
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
        }
        .navigationTitle("Kaivo in Safari")
        .navigationBarTitleDisplayMode(.inline)
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
