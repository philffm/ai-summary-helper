import Foundation

/// What the Safari extension hands over (plugin/src/bg/nativeLibrary.js). Summary and content are HTML.
struct InboxArticle: Codable, Equatable {
    struct Highlight: Codable, Equatable {
        var text: String
        /// Suggested by the AI (a "ghost" highlight), not marked by the reader.
        var ai: Bool
    }
    struct Question: Codable, Equatable {
        var q: String
        var a: String
    }
    var id: String
    var url: String
    var title: String
    var tags: [String]
    var words: Int
    var savedAt: String
    var progress: Double
    var summary: String
    var content: String
    var highlights: [Highlight]
    /// The questions prepared with the summary.
    var questions: [Question]?
}

/// A feed Safari subscribes to.
struct InboxFeed: Codable, Equatable {
    var url: String
    var title: String
    var tags: [String]
}

/// The hand-over folder in the shared container: the extension writes one file per article, the app reads and removes them.
enum SafariInbox {
    static let maxBytes = 2_000_000
    static let maxImageBytes = 1_200_000
    private static let removedFile = "safari-removed.json"
    private static let folderFile = "safari-folder.json"
    // beside the article folder: everything in there is read as an article
    private static let feedsFile = "safari-feeds.json"
    static var pendingFeeds: [InboxFeed] { SharedStore.read([InboxFeed].self, from: feedsFile) ?? [] }
    static func clearFeeds() { SharedStore.write([InboxFeed](), to: feedsFile) }

    static var directory: URL {
        let dir = SharedStore.directory.appending(path: "safari", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Pictures wait in images/<article id>/<number>.
    static func images(of id: String) -> URL { directory.appending(path: "images/\(id)", directoryHint: .isDirectory) }

    /// JPEG, PNG, GIF or WebP, told by the first bytes.
    static func isPicture(_ data: Data) -> Bool {
        let head = [UInt8](data.prefix(12))
        return head.starts(with: [0xFF, 0xD8, 0xFF]) || head.starts(with: [0x89, 0x50, 0x4E, 0x47]) || head.starts(with: Array("GIF8".utf8))
            || (head.count == 12 && head.starts(with: Array("RIFF".utf8)) && Array(head[8...]) == Array("WEBP".utf8))
    }

    /// An id of this shared folder: a new one tells the extension to send everything again.
    static var folderID: String {
        if let id = SharedStore.read(String.self, from: folderFile) { return id }
        let id = UUID().uuidString
        SharedStore.write(id, to: folderFile)
        return id
    }

    /// Ids come from the extension and become file names.
    static func isValid(id: String) -> Bool {
        !id.isEmpty && id.count <= 80 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    /// Articles deleted in the app stay deleted, even when Safari sends them again.
    static var removed: Set<String> { SharedStore.read(Set<String>.self, from: removedFile) ?? [] }
    static func markRemoved(_ id: String) { SharedStore.write(removed.union([id]), to: removedFile) }

    /// One message of the extension; the answer goes back to it.
    static func handle(_ message: [String: Any]) -> [String: Any] {
        guard SharedStore.isShared else { return ["ok": false, "error": "no shared folder"] }
        switch message["type"] as? String {
        case "model", "model-error":
            return SafariModel.handle(message)
        case "hello":
            SafariModel.noteContact()
            return ["ok": true, "folder": folderID]
        case "article":
            guard let object = message["article"], JSONSerialization.isValidJSONObject(object),
                  let data = try? JSONSerialization.data(withJSONObject: object), data.count <= maxBytes,
                  let article = try? JSONDecoder().decode(InboxArticle.self, from: data), isValid(id: article.id) else {
                return ["ok": false, "error": "not an article"]
            }
            if removed.contains(article.id) { return ["ok": true] }
            do {
                try data.write(to: directory.appending(path: article.id + ".json"), options: .atomic)
                return ["ok": true]
            } catch {
                return ["ok": false, "error": "could not write"]
            }
        case "image":
            guard let id = message["id"] as? String, isValid(id: id), let name = message["name"] as? String,
                  !name.isEmpty, name.count <= 3, name.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let text = message["data"] as? String, text.utf8.count <= maxImageBytes * 4 / 3 + 4,
                  let data = Data(base64Encoded: text), data.count <= maxImageBytes, isPicture(data) else {
                return ["ok": true]   // a picture the app cannot take must not hold back the article
            }
            if removed.contains(id) { return ["ok": true] }
            do {
                try FileManager.default.createDirectory(at: images(of: id), withIntermediateDirectories: true)
                try data.write(to: images(of: id).appending(path: name), options: .atomic)
                return ["ok": true]
            } catch {
                return ["ok": false, "error": "could not write"]
            }
        case "feeds":
            guard let object = message["feeds"], JSONSerialization.isValidJSONObject(object),
                  let data = try? JSONSerialization.data(withJSONObject: object), data.count <= maxBytes,
                  let feeds = try? JSONDecoder().decode([InboxFeed].self, from: data) else {
                return ["ok": false, "error": "not a feed list"]
            }
            SharedStore.write(Array(feeds.prefix(500)), to: feedsFile)
            return ["ok": true]
        default:
            return ["ok": false, "error": "unknown message"]
        }
    }

    static func read(_ file: URL) -> InboxArticle? {
        (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(InboxArticle.self, from: $0) }
    }

    /// The waiting articles; unreadable files are removed.
    static func pending(in folder: URL = directory) -> [(file: URL, article: InboxArticle)] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.compactMap { file in
            guard let article = read(file) else {
                try? FileManager.default.removeItem(at: file)
                return nil
            }
            return (file, article)
        }
    }
}
