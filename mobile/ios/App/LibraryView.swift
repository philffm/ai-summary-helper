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
    @State private var topic: String?
    @Environment(Router.self) private var router

    private var shown: [Article] {
        library.articles.filter { article in
            (filter == .all || (filter == .unread ? article.isUnread : article.firstHighlight != nil))
                && (topic == nil || article.tags.contains(topic!))
                && (search.isEmpty || ([article.title, article.host] + article.tags).contains { $0.localizedStandardContains(search) })
        }
    }

    var body: some View {
        @Bindable var router = router
        return NavigationStack(path: $router.libraryPath) {
            List {
                if !library.articles.isEmpty {
                    Section {
                        TopicBubbles(topics: Array(library.topics.prefix(6)), selection: $topic)
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
                    ForEach(shown) { article in
                        NavigationLink(value: Route.article(article.id)) { ArticleRow(article: article) }
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) { library.remove(article.id) }
                            }
                    }
                    if shown.isEmpty {
                        if !search.isEmpty {
                            ContentUnavailableView.search(text: search)
                        } else {
                            ContentUnavailableView("No articles", systemImage: "books.vertical",
                                                   description: library.articles.isEmpty ? Text("Save articles from your feeds and they appear here.") : Text("Nothing matches this filter."))
                        }
                    }
                } footer: {
                    if !shown.isEmpty { SampleNote() }
                }
            }
            .navigationTitle("Library")
            .routes()
            .searchable(text: $search, prompt: "Words, topics, sources")
        }
    }
}
