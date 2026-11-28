import Foundation

/// The app's end of a synced library: join it, run it, leave it. The work is done by the extension's modules (SyncHost).
/// Runs only fetch unless writing back is switched on: how far articles were read and their highlights, nothing else.
struct LibrarySync {
    struct State: Decodable {
        struct Last: Decodable {
            struct Progress: Decodable {
                /// "checking", "pulling" (fetching) or "uploading"
                var phase: String?
                let done: Int
                let total: Int
            }
            let at: String?
            let ok: Bool?
            /// Set while a run is going.
            let running: Progress?
        }
        let id: String
        let service: String?
        let server: String?
        let root: String
        let articles: Int
        let writesBack: Bool
        let last: Last?
    }

    /// An entry of the library's feed list; a removed one holds only its address and time.
    struct FeedEntry: Decodable, Equatable {
        let url: String
        let title: String?
        let tags: [String]?
        let updatedAt: Int64
        let removed: Bool?
    }

    struct Run: Decodable {
        /// The library's feed list; nil where it could not be read.
        var feeds: [FeedEntry]?
        let pulled: Int
        let applied: Int
        let pushed: Int
        /// What was told apart or folded together after the fetch; nil when the fetch did not get that far.
        var moved: Int?
        let errors: [String]
    }

    /// What a code says, to be looked at before joining.
    struct Code: Decodable, Equatable {
        let service: String
        let server: String
        let folder: String
        /// The passphrase is part of the code.
        let words: Bool
        /// Plain http, allowed only inside one's own network.
        let plain: Bool
    }

    let host: SyncHost
    private let storage: SyncStorage
    private let folder: URL

    /// The chosen folder of a library in Files.
    let place: PlaceFolder

    /// The library in this folder, its secrets in the Keychain.
    init(folder: URL, vault: SyncVault, writeBack: Bool = false, network: URLSessionConfiguration = .ephemeral) throws {
        self.folder = folder
        storage = try SyncStorage(url: folder.appending(path: "library.sqlite"))
        place = PlaceFolder(bookmark: folder.appending(path: "place.bookmark"))
        host = try SyncHost(storage: try GuardedStorage(storage, vault: vault), writeBack: writeBack, folder: place, network: network)
    }

    /// Joins the library in a folder of Files. `bookmark` remembers the folder, `root` says where in it the library lies.
    /// Where joining fails, the folder remembered before stays.
    func joinFolder(bookmark: Data, root: String, name: String, passphrase: String) async throws {
        let target = backupBeforeJoin, storage = storage, before = place.remembered
        try await host.read { _ in try storage.backup(to: target) }
        try place.remember(bookmark)
        do {
            _ = try await host.run("return sync.joinFolder(input);", input: ["root": root, "name": name, "passphrase": passphrase])
        } catch {
            try? place.remember(before)
            throw error
        }
    }

    /// nil when this is no code of a library.
    func look(_ code: String) async throws -> Code? {
        try JSONDecoder().decode(Code?.self, from: try await host.run("return sync.look(input.code);", input: ["code": code]))
    }

    /// The library as it was before the last join: where it and the server differ, the server's values win.
    var backupBeforeJoin: URL { folder.appending(path: "library.before-join.sqlite") }

    /// `code`: what the browser shows for a phone (aish-library://…). The passphrase may be part of it.
    func join(code: String, passphrase: String = "") async throws {
        let target = backupBeforeJoin, storage = storage
        try await host.read { _ in try storage.backup(to: target) }
        _ = try await host.run("return sync.join(input);", input: ["code": code, "passphrase": passphrase])
    }

    /// Ends a run that has a time limit after its current step.
    func stop() async {
        _ = try? await host.run("return sync.stop();")
    }

    /// `seconds`: no longer than about this; what is left comes with the next run.
    /// `feeds`: the app's own feed list, a removed feed as a marker; it joins the library's where writing back is on.
    func run(seconds: Double? = nil, feeds: [Feed] = []) async throws -> Run {
        var input: [String: Any] = ["feeds": feeds.map { ["url": $0.url, "title": $0.title, "tags": $0.tags, "updatedAt": $0.updatedAt, "removed": $0.removed] }]
        if let seconds { input["seconds"] = seconds }
        return try JSONDecoder().decode(Run.self, from: try await host.run("return sync.run(input);", input: input))
    }

    /// nil when no library is joined.
    func state() async throws -> State? {
        try JSONDecoder().decode(State?.self, from: try await host.run("return sync.state();"))
    }

    /// What switching on writing back would add to the library.
    struct Waiting: Decodable, Equatable {
        /// Articles saved on this device.
        let articles: Int
        /// Summaries written here for articles of the library that have none.
        let summaries: Int
        /// Articles of the library that get prepared questions kept here.
        let questions: Int
    }

    func waiting() async throws -> Waiting {
        try JSONDecoder().decode(Waiting.self, from: try await host.run("return sync.waiting();"))
    }

    /// Whether runs also send what changed here; off for every library until switched on.
    func setWriteBack(_ on: Bool) async throws {
        _ = try await host.run("return sync.setWriteBack(input);", input: ["on": on])
    }

    func leave() async throws {
        _ = try await host.run("return sync.leave();")
    }
}
