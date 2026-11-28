import Foundation

/// The folder of a library that lies in Files, for example in iCloud Drive: chosen once, remembered by a bookmark, and
/// only ever read. Files that iCloud has not brought to this device yet are asked for; until they are here, reading them
/// fails, so that a run never takes them for gone.
final class PlaceFolder: @unchecked Sendable {
    enum Failure: Error, LocalizedError, CustomStringConvertible {
        case noFolder, onItsWay, unreadable(String)

        var description: String {
            switch self {
            case .noFolder: "The folder is not there any more. Choose it again."
            case .onItsWay: "iCloud is still downloading files. Sync again in a moment."
            case .unreadable(let why): "The folder could not be read: " + why
            }
        }
        var errorDescription: String? { description }
    }

    struct Entry: Equatable {
        let name: String
        /// Milliseconds since 1970.
        let modified: Int64
        let size: Int
    }

    private static let largest = 25 * 1024 * 1024
    private let bookmark: URL

    /// `bookmark`: the file that remembers the chosen folder.
    init(bookmark: URL) { self.bookmark = bookmark }

    var remembered: Data? { try? Data(contentsOf: bookmark) }

    /// Remembers this folder, or forgets with nil.
    func remember(_ data: Data?) throws {
        if let data { try data.write(to: bookmark, options: .atomic) } else if FileManager.default.fileExists(atPath: bookmark.path) { try FileManager.default.removeItem(at: bookmark) }
    }

    /// What is to be remembered of a folder the picker gave.
    static func bookmark(for url: URL) throws -> Data {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        return try url.bookmarkData()
    }

    /// Where the library lies within a chosen folder: in it, in "aish-sync" below it, or in one other folder below it.
    static func root(in folder: URL) -> String? {
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        func holds(_ url: URL) -> Bool {
            let files = FileManager.default
            return files.fileExists(atPath: url.appending(path: "meta.json").path) || files.fileExists(atPath: url.appending(path: ".meta.json.icloud").path)
        }
        if holds(folder) { return "." }
        if holds(folder.appending(path: "aish-sync")) { return "aish-sync" }
        let below = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles)) ?? []
        let found = below.filter { holds($0) }
        return found.count == 1 ? found[0].lastPathComponent : nil
    }

    private func within<Value>(_ body: (URL) throws -> Value) throws -> Value {
        var stale = false
        guard let data = remembered, let folder = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale) else { throw Failure.noFolder }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        if stale, let fresh = try? folder.bookmarkData() { try? remember(fresh) }
        return try body(folder)
    }

    /// A path of plain names below the folder; nothing leads out of it.
    private func url(_ path: String, below folder: URL) throws -> URL {
        let names = path.split(separator: "/").map(String.init)
        guard !names.contains(where: { $0 == ".." || $0 == "." }) else { throw Failure.unreadable("an unusual path") }
        return names.reduce(folder) { $0.appending(path: $1) }
    }

    private static func placeholder(of url: URL) -> URL {
        url.deletingLastPathComponent().appending(path: "." + url.lastPathComponent + ".icloud")
    }

    /// The files of a folder, those still in iCloud under their own names; empty where there is no such folder.
    func list(_ path: String) throws -> [Entry] {
        try within { folder in
            let directory = try url(path, below: folder)
            guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isDirectoryKey]
            let found: [URL]
            do { found = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys) } catch { throw Failure.unreadable(error.localizedDescription) }
            var entries: [String: Entry] = [:]
            for file in found {
                let values = try? file.resourceValues(forKeys: Set(keys))
                if values?.isDirectory == true { continue }
                var name = file.lastPathComponent
                let waiting = name.hasPrefix(".") && name.hasSuffix(".icloud")
                if waiting { name = String(name.dropFirst().dropLast(".icloud".count)) } else if name.hasPrefix(".") { continue }
                // a file that is here counts before its placeholder
                if waiting && entries[name] != nil { continue }
                let modified = Int64((values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)
                entries[name] = Entry(name: name, modified: modified, size: waiting ? 0 : values?.fileSize ?? 0)
            }
            return entries.values.sorted { $0.name < $1.name }
        }
    }

    /// A file's bytes and when it was written; nil where there is no such file.
    func read(_ path: String) throws -> (bytes: Data, modified: Int64)? {
        try within { folder in
            let file = try url(path, below: folder)
            let files = FileManager.default
            if !files.fileExists(atPath: file.path) {
                guard files.fileExists(atPath: Self.placeholder(of: file).path) else { return nil }
                try? files.startDownloadingUbiquitousItem(at: file)
                throw Failure.onItsWay
            }
            let status = try? file.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]).ubiquitousItemDownloadingStatus
            if status == .notDownloaded {
                try? files.startDownloadingUbiquitousItem(at: file)
                throw Failure.onItsWay
            }
            var answer: Result<(Data, Int64), Error> = .failure(Failure.unreadable("no answer"))
            var coordination: NSError?
            NSFileCoordinator().coordinate(readingItemAt: file, options: .withoutChanges, error: &coordination) { at in
                answer = Result {
                    let values = try at.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                    guard (values.fileSize ?? 0) <= Self.largest else { throw Failure.unreadable("a file is too large") }
                    return (try Data(contentsOf: at), Int64((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000))
                }
            }
            if let coordination { throw Failure.unreadable(coordination.localizedDescription) }
            do {
                let (bytes, modified) = try answer.get()
                return (bytes, modified)
            } catch let failure as Failure {
                throw failure
            } catch {
                throw Failure.unreadable(error.localizedDescription)
            }
        }
    }
}
