import SwiftUI

extension Int64 {
    /// "49 MB"
    var fileSize: String { ByteCountFormatter.string(fromByteCount: self, countStyle: .file) }
}

/// Under an episode's controls: load it to the device, see how far that is, or remove it.
struct DownloadLine: View {
    let id: String
    let url: URL
    let title: String
    let show: String
    /// What the feed says the file weighs, when it says something believable.
    let expected: Int64?
    @State private var podcasts = PodcastStore.shared

    var body: some View {
        VStack(spacing: 8) {
            Divider()
            switch podcasts.state(id) {
            case .none:
                row(Label("Load episode", systemImage: "arrow.down.circle"), detail: expected.map(\.fileSize)) { load() }
            case .waiting:
                HStack {
                    Label("Waiting for Wi-Fi", systemImage: "wifi").foregroundStyle(.secondary)
                    Spacer()
                    Button("Load now") { load(mobile: true) }
                    Button("Cancel") { podcasts.remove(id) }.foregroundStyle(.secondary)
                }
                .frame(minHeight: 44)
            case .loading(let done, let total):
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        if total > 0 {
                            Text("Loading… \(done.fileSize) of \(total.fileSize)")
                            ProgressView(value: Double(min(done, total)), total: Double(total))
                        } else {
                            Text("Loading… \(done.fileSize)")
                            ProgressView()
                        }
                    }
                    Spacer()
                    Button("Cancel") { podcasts.remove(id) }.frame(minHeight: 44)
                }
            case .loaded(let bytes):
                HStack {
                    Label("On this device", systemImage: "checkmark.circle.fill")
                    Spacer()
                    Text(verbatim: bytes.fileSize).foregroundStyle(.secondary)
                    Button("Remove", role: .destructive) {
                        if AudioPlayer.shared.current == id { AudioPlayer.shared.stop() }
                        podcasts.remove(id)
                    }
                }
                .frame(minHeight: 44)
            case .failed:
                row(Label("The download failed", systemImage: "exclamationmark.circle"), detail: String(localized: "Try again")) { load() }
            }
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.borderless)
    }

    private func load(mobile: Bool = false) { podcasts.load(id, title: title, show: show, url: url, mobile: mobile) }

    private func row(_ label: Label<Text, Image>, detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                label
                Spacer()
                if let detail { Text(verbatim: detail).fontWeight(.regular).foregroundStyle(.secondary) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
    }
}

/// "Storage": the episodes on this device, what they take, and what happens to them.
struct StorageView: View {
    @State private var podcasts = PodcastStore.shared
    @AppStorage(PodcastStore.removeKey) private var removeHeard = false
    @AppStorage(PodcastStore.wifiKey) private var wifiOnly = true

    var body: some View {
        List {
            Section {
                VStack(spacing: 6) {
                    Text(verbatim: podcasts.totalBytes.fileSize).font(.largeTitle.weight(.bold))
                    Text("Episodes on this device: \(podcasts.loaded.count)").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
            }
            if !podcasts.loaded.isEmpty {
                Section("Loaded") {
                    ForEach(podcasts.loaded) { episode in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: episode.title).lineLimit(2)
                                HStack(spacing: 4) {
                                    Text(verbatim: episode.bytes.fileSize + " ·")
                                    state(episode.id)
                                }
                                .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button { remove(episode.id) } label: { Image(systemName: "xmark").frame(width: 40, height: 44) }
                                .buttonStyle(.borderless)
                                .foregroundStyle(.red)
                                .accessibilityLabel("Remove")
                        }
                        .swipeActions { Button("Remove", systemImage: "trash", role: .destructive) { remove(episode.id) } }
                    }
                }
                if podcasts.heardBytes > 0 {
                    Section {
                        Button("Remove the heard ones (\(podcasts.heardBytes.fileSize))", role: .destructive) {
                            podcasts.removeHeard(except: AudioPlayer.shared.playing ? AudioPlayer.shared.current : nil)
                        }
                    }
                }
            }
            Section {
                Toggle("Remove after listening", isOn: $removeHeard)
                Toggle("Load on Wi-Fi only", isOn: $wifiOnly)
            } footer: {
                Text("Loaded episodes stay on this device: not synced, not in the iCloud backup.")
            }
        }
        .navigationTitle("Storage")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func remove(_ id: String) {
        if AudioPlayer.shared.current == id { AudioPlayer.shared.stop() }
        podcasts.remove(id)
    }

    @ViewBuilder
    private func state(_ id: String) -> some View {
        let l = podcasts.listening(id)
        if l.heard {
            Text("Heard")
        } else if podcasts.resumeAt(id) != nil {
            Text("Started")
        } else {
            Text("New")
        }
    }
}
