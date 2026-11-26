import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Share → Kaivo": keeps a link for the library. The extension only notes it down; the app fetches the text when it is
/// opened, because an extension has little memory and little time.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { @MainActor in
            let found = await shared()
            show(ShareView(url: found.url, title: found.title, canKeep: SharedStore.isShared,
                           keep: { [weak self] summarize in self?.keep(found, summarize: summarize) },
                           close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }))
        }
    }

    private func show(_ view: ShareView) {
        let host = UIHostingController(rootView: view)
        addChild(host)
        host.view.frame = self.view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    private func keep(_ found: (url: URL?, title: String), summarize: Bool) {
        guard let url = found.url else { return }
        SharedLinks.add(SharedLink(url: url.absoluteString, title: found.title, summarize: summarize, date: .now))
    }

    /// The address and, where the sharing app says it, the title.
    private func shared() async -> (url: URL?, title: String) {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let title = items.compactMap { $0.attributedContentText?.string }.first ?? ""
        let providers = items.flatMap { $0.attachments ?? [] }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, SharedLinks.isWeb(url) {
                return (url, SharedLinks.link(in: title) == nil ? title : "")
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String, let url = SharedLinks.link(in: text) {
                return (url, "")
            }
        }
        return (nil, "")
    }
}

struct ShareView: View {
    let url: URL?
    let title: String
    /// False in a build without the shared folder: the app could not see what is kept here.
    let canKeep: Bool
    let keep: (Bool) -> Void
    let close: () -> Void
    @State private var summarize = false
    @State private var kept = false

    var body: some View {
        NavigationStack {
            Form {
                if let url, canKeep {
                    Section {
                        if !title.isEmpty { Text(verbatim: title).font(.headline).lineLimit(3) }
                        Text(verbatim: url.absoluteString).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Section {
                        Toggle("Summarize it too", isOn: $summarize)
                    } footer: {
                        Text("Kaivo fetches the text the next time you open it.")
                    }
                    Section {
                        Button {
                            keep(summarize)
                            kept = true
                            Task { @MainActor in
                                try? await Task.sleep(for: .seconds(0.9))
                                close()
                            }
                        } label: {
                            if kept {
                                Label("Saved", systemImage: "checkmark")
                            } else {
                                Label("Save to library", systemImage: "bookmark")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .disabled(kept)
                    }
                } else if url == nil {
                    Text("There is no web link in what you shared.")
                } else {
                    Text("This build cannot hand links to the app.")
                }
            }
            .navigationTitle(Text(verbatim: "Kaivo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) } }
        }
    }
}
