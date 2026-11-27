import Foundation
import SQLite3

/// What the sync modules read and write: JSON by key.
protocol SyncStoring: AnyObject {
    func get(_ keys: [String]) throws -> [String: String]
    func keys() throws -> [String]
    func write(_ set: [String: String], remove: [String]) throws
}

/// The library in the shape of the extension's local storage: one key, one JSON value (articles:index, articles:rec:<id>,
/// hl:page:<key>, …). A write of several keys happens whole or not at all. One owner at a time: the sync engine's queue.
final class SyncStorage: SyncStoring {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    private var db: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // readable after the first unlock, so that a refresh in the background can work while the phone is locked
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_FILEPROTECTION_COMPLETEUNTILFIRSTUSERAUTHENTICATION
        guard sqlite3_open_v2(url.path, &db, flags, nil) == SQLITE_OK else {
            let failure = Failure(description: "The library cannot be opened: \(String(cString: sqlite3_errmsg(db)))")
            sqlite3_close(db)
            db = nil
            throw failure
        }
        sqlite3_busy_timeout(db, 2000)
        try run("PRAGMA journal_mode = WAL")
        try run("CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID")
    }

    deinit { sqlite3_close(db) }

    /// The stored JSON of those keys that exist.
    func get(_ keys: [String]) throws -> [String: String] {
        var out: [String: String] = [:]
        try with("SELECT value FROM items WHERE key = ?1") { statement in
            for key in keys {
                sqlite3_reset(statement)
                sqlite3_bind_text(statement, 1, key, -1, Self.transient)
                switch sqlite3_step(statement) {
                case SQLITE_ROW: out[key] = text(statement, 0)
                case SQLITE_DONE: continue
                default: throw failure()
                }
            }
        }
        return out
    }

    func keys() throws -> [String] {
        var out: [String] = []
        try with("SELECT key FROM items ORDER BY key") { statement in
            while true {
                switch sqlite3_step(statement) {
                case SQLITE_ROW: out.append(text(statement, 0))
                case SQLITE_DONE: return
                default: throw failure()
                }
            }
        }
        return out
    }

    func write(_ set: [String: String]) throws { try write(set, remove: []) }

    func write(_ set: [String: String], remove: [String]) throws {
        try run("BEGIN IMMEDIATE")
        do {
            try with("INSERT INTO items (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value") { statement in
                for (key, value) in set {
                    sqlite3_reset(statement)
                    sqlite3_bind_text(statement, 1, key, -1, Self.transient)
                    sqlite3_bind_text(statement, 2, value, -1, Self.transient)
                    guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
                }
            }
            try with("DELETE FROM items WHERE key = ?1") { statement in
                for key in remove {
                    sqlite3_reset(statement)
                    sqlite3_bind_text(statement, 1, key, -1, Self.transient)
                    guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
                }
            }
            try run("COMMIT")
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    private func text(_ statement: OpaquePointer?, _ column: Int32) -> String {
        guard let bytes = sqlite3_column_text(statement, column) else { return "" }
        let count = Int(sqlite3_column_bytes(statement, column))
        return String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self)
    }

    private func failure() -> Failure { Failure(description: String(cString: sqlite3_errmsg(db))) }

    private func run(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
    }

    private func with(_ sql: String, _ body: (OpaquePointer?) throws -> Void) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        try body(statement)
    }
}
