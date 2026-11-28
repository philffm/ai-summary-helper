import SwiftUI

struct FeedsView: View {
    @Environment(FeedsModel.self) private var feeds
    @Environment(Router.self) private var router
    @Environment(SyncModel.self) private var sync
    @State private var unreadOnly = false
    @State private var sheet: Sheet?

    private enum Sheet: String, Identifiable { case add, manage; var id: String { rawValue } }

    var body: some View {
        @Bindable var router = router
        ListAndDetail(path: $router.feedsPath, empty: "Choose an article", symbol: "dot.radiowaves.up.forward") { selection in
            List(selection: selection) {
                if feeds.feeds.isEmpty {
                    Section {
                        ContentUnavailableView("No feeds yet", systemImage: "dot.radiowaves.up.forward",
                                               description: Text("Follow sites and podcasts you choose. Pick one to start."))
                    }
                    .listRowBackground(Color.clear)
                    SuggestedSection()
                } else {
                    Picker("Show", selection: $unreadOnly) {
                        Text("All").tag(false)
                        Text("Unread").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    Section {
                        let shown = feeds.entries.filter { !unreadOnly || !$0.stored.read }
                        ForEach(shown) { entry in
                            NavigationLink(value: Route.item(feed: entry.feed.url, id: entry.stored.item.id)) { EntryRow(entry: entry) }
                                .swipeActions(edge: .leading) {
                                    Button { feeds.setRead(entry, !entry.stored.read) } label: {
                                        if entry.stored.read {
                                            Label("Mark unread", systemImage: "circle.fill")
                                        } else {
                                            Label("Mark read", systemImage: "checkmark")
                                        }
                                    }
                                    .tint(KaivoTokens.accent)
                                }
                        }
                        if shown.isEmpty {
                            if feeds.refreshing { ProgressView().frame(maxWidth: .infinity) } else { Text("Nothing new.").foregroundStyle(.secondary) }
                        }
                    } footer: {
                        SampleNote()
                    }
                }
            }
            .navigationTitle("Feeds")
            .refreshable { await feeds.refresh() }
            .toolbar {
                SyncToolbar(sync: sync)
                if !feeds.feeds.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { sheet = .manage } label: { Label("Your feeds", systemImage: "list.bullet") }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { sheet = .add } label: { Label("Add feed", systemImage: "plus") }
                }
            }
            .sheet(item: $sheet) { which in
                if which == .add { AddFeedView() } else { ManageFeedsView() }
            }
        }
    }
}

struct EntryRow: View {
    let entry: FeedEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle().fill(entry.stored.read ? Color.clear : KaivoTokens.accent).frame(width: 8, height: 8).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: entry.stored.item.title).font(.body.weight(entry.stored.read ? .regular : .medium)).fontDesign(.serif).lineLimit(3)
                Text(verbatim: [entry.feed.name, entry.stored.item.published.map { Dates.relativeDay($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(entry.stored.read ? Text(verbatim: "") : Text("Unread"))
    }
}

/// The starter list shared with the extension and the Android app (shared/suggested-feeds.json).
struct SuggestedSection: View {
    @Environment(FeedsModel.self) private var feeds
    @State private var adding: String?
    @State private var failure: FeedFetcher.Failure?

    var body: some View {
        Section {
            ForEach(feeds.suggestions) { suggestion in
                Button {
                    adding = suggestion.url
                    Task {
                        do { try await feeds.add(suggestion.url, title: suggestion.name, tags: suggestion.tags ?? []) }
                        catch { failure = error as? FeedFetcher.Failure ?? .unreachable }
                        adding = nil
                    }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: suggestion.name).foregroundStyle(Color.primary)
                            if let note = suggestion.note { Text(verbatim: note).font(.footnote).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if adding == suggestion.url { ProgressView() } else { Image(systemName: "plus.circle").accessibilityHidden(true) }
                    }
                }
                .disabled(adding != nil)
            }
        } header: {
            Text("Suggested")
        } footer: {
            if let failure { Text(failure.message).foregroundStyle(.red) }
        }
    }
}

struct AddFeedView: View {
    @Environment(FeedsModel.self) private var feeds
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var loading = false
    @State private var failure: FeedFetcher.Failure?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Address of a site or feed", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(add)
                    Button(action: add) {
                        if loading { ProgressView() } else { Text("Add feed") }
                    }
                    .disabled(loading || address.isEmpty)
                } footer: {
                    if let failure { Text(failure.message).foregroundStyle(.red) }
                }
                SuggestedSection()
            }
            .navigationTitle("Add feed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func add() {
        guard !loading, !address.isEmpty else { return }
        loading = true
        failure = nil
        Task {
            do { try await feeds.add(address); dismiss() }
            catch { failure = error as? FeedFetcher.Failure ?? .unreachable }
            loading = false
        }
    }
}

struct ManageFeedsView: View {
    @Environment(FeedsModel.self) private var feeds
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(feeds.feeds) { feed in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: feed.name)
                        if feeds.states[feed.url]?.failed == true {
                            Label("Could not be loaded", systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Text(verbatim: feed.url).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .swipeActions { Button("Delete", systemImage: "trash", role: .destructive) { feeds.remove(feed.url) } }
                }
            }
            .navigationTitle("Your feeds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}

extension FeedFetcher.Failure {
    var message: LocalizedStringKey {
        switch self {
        case .address: "That is not a web address."
        case .insecure: "iOS only loads secure (https) addresses."
        case .unreachable: "The address could not be loaded."
        case .tooLarge: "That page is too large to be a feed."
        case .notAFeed: "No feed was found there."
        }
    }
}
