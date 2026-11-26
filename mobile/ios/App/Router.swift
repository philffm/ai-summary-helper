import Observation
import SwiftUI

enum Route: Hashable {
    case article(String)
    case item(feed: String, id: String)
}

/// Which tab is shown and what is open in it, so a widget or link can lead to an article.
@Observable
final class Router {
    var tab = LaunchOptions.startTab
    var todayPath: [Route] = []
    var feedsPath: [Route] = []
    var libraryPath: [Route] = LaunchOptions.startArticle.map { [.article($0)] } ?? []

    func open(_ link: DeepLink) {
        switch link {
        case .today:
            tab = "today"; todayPath = []
        case .article(let id):
            tab = "library"; libraryPath = [.article(id)]
        case .item(let feed, let id):
            tab = "feeds"; feedsPath = [.item(feed: feed, id: id)]
        }
    }
}

extension View {
    /// The screens a list in any tab can lead to.
    func routes() -> some View {
        navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
}
