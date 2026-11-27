import Foundation

/// The app's end of a synced library: join it, fetch it, leave it. The work is done by the extension's modules (SyncHost).
/// Until the app also writes back, runs only fetch.
struct LibrarySync {
    struct State: Decodable {
        struct Last: Decodable {
            let at: String?
            let ok: Bool?
        }
        let id: String
        let service: String?
        let server: String?
        let root: String
        let articles: Int
        let last: Last?
    }

    struct Run: Decodable {
        let pulled: Int
        let applied: Int
        let pushed: Int
        let errors: [String]
    }

    let host: SyncHost

    init(host: SyncHost) { self.host = host }

    /// The library in this folder, its secrets in the Keychain.
    init(folder: URL, vault: SyncVault, network: URLSessionConfiguration = .ephemeral) throws {
        let storage = try GuardedStorage(try SyncStorage(url: folder.appending(path: "library.sqlite")), vault: vault)
        host = try SyncHost(storage: storage, pullOnly: true, network: network)
    }

    /// `code`: what the browser shows for a phone (aish-library://…). The passphrase may be part of it.
    func join(code: String, passphrase: String = "") async throws {
        _ = try await host.run("return sync.join(input);", input: ["code": code, "passphrase": passphrase])
    }

    func run() async throws -> Run {
        try JSONDecoder().decode(Run.self, from: try await host.run("return sync.run();"))
    }

    /// nil when no library is joined.
    func state() async throws -> State? {
        try JSONDecoder().decode(State?.self, from: try await host.run("return sync.state();"))
    }

    func leave() async throws {
        _ = try await host.run("return sync.leave();")
    }
}
