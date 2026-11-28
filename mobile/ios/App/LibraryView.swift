import SwiftUI

struct LibraryView: View {
    private enum Filter: String, CaseIterable, Identifiable {
        case all, unread, highlighted
        var id: Self { self }
        var title: LocalizedStringKey { self == .all ? "All" : self == .unread ? "Unread" : "Highlighted" }
    }

    @Environment(Library.self) private var library
    @State private var search = ""
    @State private var filter = Filter.all
    /// The topics narrowed down to, in the order they were chosen.
    @State private var chosen: [String] = []
    /// A topic held over the middle of the net.
    @State private var preview: String?
    @Environment(Router.self) private var router
    @Environment(SyncModel.self) private var sync
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// What the filter and the search leave, before any topic.
    private var matching: [Article] {
        library.articles.filter { article in
            (filter == .all || (filter == .unread ? article.isUnread : article.firstHighlight != nil))
                && (search.isEmpty || ([article.title, article.host] + article.tags).contains { $0.localizedStandardContains(search) })
        }
    }

    var body: some View {
        @Bindable var router = router
        return ListAndDetail(path: $router.libraryPath, empty: "Choose an article", symbol: "books.vertical") { selection in
            let matching = matching   // filtered once for the list and the net
            let shown = matching.filter { article in chosen.allSatisfy(article.tags.contains) }
            let listed = preview.map { topic in shown.filter { $0.tags.contains(topic) } } ?? shown
            return List(selection: selection) {
                if !library.articles.isEmpty {
                    Section {
                        Group {
                            if chosen.isEmpty {
                                TopicBubbles(topics: Array(library.topics.prefix(6))) { name in
                                    withAnimation(reduceMotion ? nil : .snappy) { chosen = [name] }
                                }
                            } else {
                                let related = Library.related(shown, to: chosen)
                                TopicNet(chosen: $chosen, articles: shown.count, related: related,
                                         // further out only from a single topic: with two, the way back would be lost
                                         beyond: chosen.count == 1 ? Library.beyond(matching, from: chosen, through: Array(related.prefix(NetLayout.most)), most: NetLayout.outerMost) : [],
                                         preview: $preview)
                            }
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        Picker("Show", selection: $filter) {
                            ForEach(Filter.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                    .listRowSeparator(.hidden)
                }
                Section {
                    ForEach(listed) { article in
                        NavigationLink(value: Route.article(article.id)) { ArticleRow(article: article) }
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) { library.remove(article.id) }
                            }
                    }
                    if listed.isEmpty {
                        if !search.isEmpty {
                            ContentUnavailableView.search(text: search)
                        } else if library.articles.isEmpty, let failure = library.failure {
                            // an empty list must not pass for an empty library
                            ContentUnavailableView("The library could not be read.", systemImage: "exclamationmark.triangle",
                                                   description: Text(verbatim: failure))
                        } else if library.loaded {
                            ContentUnavailableView("No articles", systemImage: "books.vertical",
                                                   description: library.articles.isEmpty ? Text("Save articles from your feeds and they appear here.") : Text("Nothing matches this filter."))
                        }
                    }
                } header: {
                    if !chosen.isEmpty {
                        let names = NetLayout.together(chosen + [preview].compactMap { $0 }).joined(separator: " + ")
                        HStack(spacing: 4) {
                            if preview != nil { Text("Preview"); Text(verbatim: "·") }
                            Text(verbatim: "\(names) · \(listed.count.formatted())")
                        }
                        .textCase(nil)
                    }
                } footer: {
                    if !listed.isEmpty { SampleNote() }
                }
            }
            .navigationTitle("Library")
            .toolbar { SyncToolbar(sync: sync) }
            .searchable(text: $search, prompt: "Words, topics, sources")
        }
    }
}
