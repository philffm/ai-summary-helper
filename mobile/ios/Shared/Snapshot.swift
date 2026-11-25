import Foundation

/// What the widgets show. The app writes it; widgets only read it and never use the network.
struct Snapshot: Codable, Equatable {
    struct Headline: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var source: String
        var link: URL
    }
    struct Quote: Codable, Equatable {
        var text: String
        var source: String
        var link: URL
    }
    struct Reading: Codable, Equatable {
        var title: String
        var source: String
        var progress: Double
        var link: URL
    }

    var headlines: [Headline] = []
    var quote: Quote?
    var reading: Reading?

    static let file = "widgets.json"
    static func load() -> Snapshot { SharedStore.read(Snapshot.self, from: file) ?? Snapshot() }
}

/// kaivo://today, kaivo://article/<id>, kaivo://item?feed=<url>&id=<id>
enum DeepLink: Equatable {
    case today
    case article(String)
    case item(feed: String, id: String)

    var url: URL {
        var c = URLComponents()
        c.scheme = "kaivo"
        switch self {
        case .today: c.host = "today"
        case .article(let id): c.host = "article"; c.queryItems = [URLQueryItem(name: "id", value: id)]
        case .item(let feed, let id): c.host = "item"; c.queryItems = [URLQueryItem(name: "feed", value: feed), URLQueryItem(name: "id", value: id)]
        }
        return c.url ?? URL(string: "kaivo://today")!
    }

    init?(_ url: URL) {
        guard url.scheme == "kaivo", let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let value = { (name: String) in c.queryItems?.first { $0.name == name }?.value }
        switch c.host {
        case "today": self = .today
        case "article": guard let id = value("id") else { return nil }; self = .article(id)
        case "item": guard let feed = value("feed"), let id = value("id") else { return nil }; self = .item(feed: feed, id: id)
        default: return nil
        }
    }
}
