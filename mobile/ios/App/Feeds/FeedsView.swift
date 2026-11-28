import SwiftUI

struct FeedsView: View {
    @Environment(FeedsModel.self) private var feeds
    @Environment(Router.self) private var router
    @Environment(SyncModel.self) private var sync
    @State private var filter = FeedFilter.all
    /// Only the feeds of this category; nil for all of them.
    @State private var category: String?
    /// Among the podcasts: the loaded ones only.
    @State private var loadedOnly = false
    @State private var podcastStore = PodcastStore.shared
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
                    let entries = feeds.entries
                    // offered where there is something to listen to
                    let podcasts = entries.contains(where: \.isPodcast)
                    let chosen = filter == .podcasts && !podcasts ? .all : filter
                    Picker("Show", selection: Binding(get: { chosen }, set: { filter = $0 })) {
                        Text("All").tag(FeedFilter.all)
                        Text("Unread").tag(FeedFilter.unread)
                        if podcasts { Text("Podcasts").tag(FeedFilter.podcasts) }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    let categories = feeds.categories
                    // one that no feed has any more counts as none
                    let narrowed = category.flatMap { categories.contains($0) ? $0 : nil }
                    if !categories.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 8) {
                                ForEach(categories, id: \.self) { name in
                                    let on = narrowed == name
                                    let unread = entries.filter { !$0.stored.read && $0.feed.has(category: name) && (chosen != .podcasts || $0.isPodcast) }.count
                                    chip(Text(verbatim: unread > 0 ? "\(name)  \(unread)" : name), on: on) { category = on ? nil : name }
                                }
                            }
                            .padding(.vertical, 1)
                        }
                        .scrollIndicators(.hidden)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .accessibilityIdentifier("categories")
                    }
                    let inCategory = narrowed.map { name in entries.filter { $0.feed.has(category: name) } } ?? entries
                    let loaded = inCategory.filter { if case .loaded = podcastStore.state($0.id) { true } else { false } }
                    if chosen == .podcasts && !loaded.isEmpty {
                        HStack(spacing: 8) {
                            chip(Text("All episodes"), on: !loadedOnly) { loadedOnly = false }
                            chip(Text("Loaded · \(loaded.count)"), on: loadedOnly) { loadedOnly = true }
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                    Section {
                        let shown = chosen == .podcasts && loadedOnly && !loaded.isEmpty ? loaded : inCategory.filter(chosen.shows)
                        ForEach(shown) { entry in
                            NavigationLink(value: Route.item(feed: entry.feed.url, id: entry.stored.item.id)) { EntryRow(entry: entry, episode: chosen == .podcasts) }
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

    private func chip(_ title: Text, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            title.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).frame(minHeight: 36)
                .foregroundStyle(on ? Color(.systemBackground) : KaivoTokens.accent)
                .background(on ? KaivoTokens.accent : Color(.secondarySystemGroupedBackground), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct EntryRow: View {
    let entry: FeedEntry
    /// Shown as an episode: how far it was heard, and whether it is loaded.
    var episode = false
    @State private var podcasts = PodcastStore.shared
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle().fill(entry.stored.read ? Color.clear : KaivoTokens.accent).frame(width: 8, height: 8).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: entry.stored.item.title).font(.body.weight(entry.stored.read ? .regular : .medium)).fontDesign(.serif).lineLimit(textSize.isAccessibilitySize ? nil : 3)
                Text(verbatim: [entry.feed.name, entry.stored.item.published.map { Dates.relativeDay($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
                if episode, let at = podcasts.resumeAt(entry.id), podcasts.listening(entry.id).of > 0 {
                    ProgressView(value: min(at, podcasts.listening(entry.id).of), total: podcasts.listening(entry.id).of).frame(maxWidth: 110)
                }
            }
            if episode, let sound = entry.stored.item.audio.flatMap(URL.init(string:)) {
                Spacer(minLength: 0)
                mark(sound)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(entry.stored.read ? Text(verbatim: "") : Text("Unread"))
        .accessibilityActions {
            if episode, let sound = entry.stored.item.audio.flatMap(URL.init(string:)), [.none, .failed].contains(podcasts.state(entry.id)) {
                Button("Load episode") { podcasts.load(entry.id, title: entry.stored.item.title, show: entry.feed.name, url: sound) }
            }
        }
    }

    @ViewBuilder
    private func mark(_ sound: URL) -> some View {
        switch podcasts.state(entry.id) {
        case .loaded:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(KaivoTokens.accent).frame(width: 36, height: 36)
                .accessibilityLabel("On this device")
        case .loading, .waiting:
            ProgressView().frame(width: 36, height: 36)
        case .none, .failed:
            Button { podcasts.load(entry.id, title: entry.stored.item.title, show: entry.feed.name, url: sound) } label: {
                Image(systemName: "arrow.down.circle").font(.title3).frame(width: 36, height: 36)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Load episode")
        }
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
                        if !feed.tags.isEmpty {
                            Text(verbatim: feed.tags.joined(separator: " · ")).font(.footnote).foregroundStyle(KaivoTokens.accent)
                        }
                        if feeds.states[feed.url]?.failed == true {
                            Label("Could not be loaded", systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Text(verbatim: feed.url).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .swipeActions { Button("Delete", systemImage: "trash", role: .destructive) { feeds.remove(feed.url) } }
                    .accessibilityElement(children: .combine)
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
