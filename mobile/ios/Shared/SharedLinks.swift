import Foundation

/// A link given to Kaivo through the system's share sheet.
struct SharedLink: Codable, Equatable {
    var url: String
    var title: String
    /// The reader wants a summary once the text is there.
    var summarize: Bool
    var date: Date
    /// What someone else sent along when they recommended it.
    var recommendation: Recommendation?
}

/// The hand-over folder for shared links: the share extension writes one file per link, the app reads and removes them.
enum SharedLinks {
    static var directory: URL {
        let dir = SharedStore.directory.appending(path: "shared", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// The first web address in what was shared.
    static func link(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap(\.url).first { isWeb($0) }
    }

    static func isWeb(_ url: URL) -> Bool { ["http", "https"].contains(url.scheme?.lowercased() ?? "") && url.host() != nil }

    @discardableResult
    static func add(_ link: SharedLink, to folder: URL = directory) -> Bool {
        guard let url = URL(string: link.url), isWeb(url), let data = try? JSONEncoder().encode(link) else { return false }
        return (try? data.write(to: folder.appending(path: UUID().uuidString + ".json"), options: .atomic)) != nil
    }

    /// What waits, the oldest first. A file that cannot be read is dropped.
    static func waiting(in folder: URL = directory) -> [(file: URL, link: SharedLink)] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.compactMap { file -> (URL, SharedLink)? in
            guard let data = try? Data(contentsOf: file), let link = try? JSONDecoder().decode(SharedLink.self, from: data) else {
                try? FileManager.default.removeItem(at: file)
                return nil
            }
            return (file, link)
        }.sorted { $0.1.date < $1.1.date }
    }
}
