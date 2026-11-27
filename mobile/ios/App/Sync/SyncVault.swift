import Foundation
import Security

/// A place for the logins and keys of the library: the Keychain, on the device only.
struct SyncVault {
    struct Failure: Error, CustomStringConvertible {
        let status: OSStatus
        var description: String { "The Keychain refused (\(status))." }
    }

    /// Keeps the vaults of different libraries apart (tests make their own).
    let scope: String
    private static let service = "eu.byphil.kaivo.sync"

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: scope + "/" + key]
    }

    func read(_ key: String) throws -> String? {
        var wanted = query(key)
        wanted[kSecReturnData as String] = true
        var found: CFTypeRef?
        let status = SecItemCopyMatching(wanted as CFDictionary, &found)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = found as? Data else { throw Failure(status: status) }
        return String(decoding: data, as: UTF8.self)
    }

    /// nil removes it.
    func write(_ key: String, _ value: String?) throws {
        guard let value else {
            let status = SecItemDelete(query(key) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
            return
        }
        // after the first unlock, so that a refresh in the background gets it; never in a backup or on another device
        let content: [String: Any] = [kSecValueData as String: Data(value.utf8),
                                      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query(key) as CFDictionary, content as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(key).merging(content) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw Failure(status: status) }
    }
}

/// The library's storage with its secrets elsewhere: what the extension keeps under these keys goes into the Keychain,
/// everything else into the database. The sync modules notice no difference.
final class GuardedStorage: SyncStoring {
    /// The server logins and the key of the library (plugin/src/modules/storageKeys.js, syncSecrets).
    static let secretKeys: Set<String> = ["sync:secrets"]
    private let library: SyncStorage
    private let vault: SyncVault

    init(_ library: SyncStorage, vault: SyncVault) throws {
        self.library = library
        self.vault = vault
        // the Keychain outlives the app: a library that is new again starts without old secrets
        if try library.keys().isEmpty {
            for key in Self.secretKeys { try vault.write(key, nil) }
        }
    }

    func get(_ keys: [String]) throws -> [String: String] {
        var out = try library.get(keys.filter { !Self.secretKeys.contains($0) })
        for key in keys where Self.secretKeys.contains(key) {
            if let value = try vault.read(key) { out[key] = value }
        }
        return out
    }

    func data(_ keys: [String]) throws -> [String: Data] { try library.data(keys.filter { !Self.secretKeys.contains($0) }) }

    func versions(_ keys: [String]) throws -> [String: Int64] { try library.versions(keys.filter { !Self.secretKeys.contains($0) }) }

    func keys() throws -> [String] {
        try library.keys() + Self.secretKeys.filter { try vault.read($0) != nil }
    }

    func write(_ set: [String: String], remove: [String]) throws {
        let secrets = set.keys.filter(Self.secretKeys.contains) + remove.filter(Self.secretKeys.contains)
        var before: [String: String?] = [:]
        for key in secrets { before[key] = .some(try vault.read(key)) }
        do {
            for key in secrets { try vault.write(key, set[key]) }
            try library.write(set.filter { !Self.secretKeys.contains($0.key) }, remove: remove.filter { !Self.secretKeys.contains($0) })
        } catch {
            // all or nothing, as one write of the database is
            for (key, value) in before { try? vault.write(key, value) }
            throw error
        }
    }
}
