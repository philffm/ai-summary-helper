import Foundation

/// JSON files in the App Group container, which the app and the widgets both see (and where what Safari saves will arrive).
/// Without the group (an unsigned or differently signed build) the app still works, in its own folder; widgets stay empty.
enum SharedStore {
    static let group = Bundle.main.object(forInfoDictionaryKey: "KaivoAppGroup") as? String ?? ""

    static var isShared: Bool { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil }

    static var directory: URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
            ?? URL.applicationSupportDirectory
        let dir = base.appending(path: "kaivo", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func read<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        guard let data = try? Data(contentsOf: directory.appending(path: name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func write(_ value: some Encodable, to name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: directory.appending(path: name), options: .atomic)
    }
}
