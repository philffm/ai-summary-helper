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
            let file = await sharedPage()
            let close = { [weak self] in _ = self?.extensionContext?.completeRequest(returningItems: nil) }
            // a recommendation comes first, also beside the words and the link it was sent with; any other page only
            // where there is no link (a browser may bring a page's own HTML along)
            if let file, file.recommendation != nil || found.url == nil {
                show(ReceivedView(recommendation: file.recommendation, canKeep: SharedStore.isShared, keep: { recommendation in
                    SharedLinks.add(SharedLink(url: recommendation.url, title: recommendation.title, summarize: false, date: .now, recommendation: recommendation))
                }, close: close))
                return
            }
            show(ShareView(url: found.url, title: found.title, canKeep: SharedStore.isShared,
                           keep: { [weak self] summarize in self?.keep(found, summarize: summarize) },
                           close: close))
        }
    }

    /// An HTML file that was shared, with the recommendation it carries, if it carries one.
    private struct SharedPage { let recommendation: Recommendation? }

    /// nil where no such file was shared.
    private func sharedPage() async -> SharedPage? {
        let providers = ((extensionContext?.inputItems as? [NSExtensionItem]) ?? []).flatMap { $0.attachments ?? [] }
        for provider in providers {
            let isPage = provider.hasItemConformingToTypeIdentifier(UTType.html.identifier)
            guard isPage || provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else { continue }
            let type = isPage ? UTType.html.identifier : UTType.fileURL.identifier
            let data: Data? = await withCheckedContinuation { done in
                _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.html.identifier) { data, _ in
                    if let data { done.resume(returning: data); return }
                    // some apps hand over the file's address only
                    _ = provider.loadItem(forTypeIdentifier: type) { item, _ in
                        let url = item as? URL ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                        guard let url, url.isFileURL, ["html", "htm"].contains(url.pathExtension.lowercased()),
                              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Recommendation.maxBytes else {
                            done.resume(returning: nil)
                            return
                        }
                        done.resume(returning: try? Data(contentsOf: url))
                    }
                }
            }
            return SharedPage(recommendation: data.flatMap { Recommendation.read($0) })
        }
        return nil
    }

    private func show(_ view: some View) {
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

/// A recommendation someone sent, looked at before anything is saved.
struct ReceivedView: View {
    let recommendation: Recommendation?
    let canKeep: Bool
    let keep: (Recommendation) -> Void
    let close: () -> Void
    @State private var kept = false

    var body: some View {
        NavigationStack {
            Form {
                if let r = recommendation, canKeep {
                    Section {
                        if !r.from.isEmpty { Text("Recommended by \(r.from)").font(.headline) }
                        if !r.note.isEmpty { Text(verbatim: r.note) }
                    } footer: {
                        Text("Name and words as sent, not checked.")
                    }
                    Section {
                        Text(verbatim: r.title).font(.headline)
                        Text(verbatim: r.url).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                    }
                    if !r.marks.isEmpty {
                        Section("Their highlights") { ForEach(Array(r.marks.enumerated()), id: \.offset) { Text(verbatim: $0.element).fontDesign(.serif) } }
                    }
                    if !r.summary.isEmpty {
                        Section("Summary from the sender") { ForEach(Array(r.summary.enumerated()), id: \.offset) { Text(verbatim: $0.element) } }
                    }
                    Section {
                        Button {
                            keep(r)
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
                    } footer: {
                        Text("Kaivo fetches the text the next time you open it.")
                    }
                } else if recommendation == nil {
                    Text("This file is not a Kaivo recommendation.")
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
