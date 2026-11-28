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

    struct Run: Decodable {
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

    /// The library in this folder, its secrets in the Keychain.
    init(folder: URL, vault: SyncVault, writeBack: Bool = false, network: URLSessionConfiguration = .ephemeral) throws {
        self.folder = folder
        storage = try SyncStorage(url: folder.appending(path: "library.sqlite"))
        host = try SyncHost(storage: try GuardedStorage(storage, vault: vault), writeBack: writeBack, network: network)
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

    /// `seconds`: no longer than about this; what is left comes with the next run.
    func run(seconds: Double? = nil) async throws -> Run {
        let input: [String: Any] = seconds.map { ["seconds": $0] } ?? [:]
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
