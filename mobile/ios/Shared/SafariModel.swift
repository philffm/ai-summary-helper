import Foundation
import Security

/// The model connection that is active in the Safari extension. It can hold a key or a sign-in token.
struct ModelConnection: Codable, Equatable {
    /// "cloud" (the hosted service) or "own" (the reader's key or server).
    var mode: String
    var service: String
    /// What the reader reads: "Mistral", "byPhil Cloud".
    var name: String
    /// "openai" (chat completions, also Ollama's own address) or "gemini".
    var format: String
    var url: String
    var model: String
    var key: String = ""
    var installId: String = ""
    var region: String = ""
}

/// Kept in the keychain, in the group the app and the extension share, on this device only.
enum SafariModel {
    private static func query(_ account: String) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "kaivo.model",
                                    kSecAttrAccount as String: account]
        if SharedStore.isShared { query[kSecAttrAccessGroup as String] = SharedStore.group }
        return query
    }

    /// What the last hand-over came to, so that the app can say why nothing is there. Never holds the connection.
    struct Report: Codable, Equatable {
        var date: Date
        /// Empty when all went well.
        var problem: String
    }

    private static let reportFile = "safari-model-report.json", contactFile = "safari-contact.json"
    static var report: Report? { SharedStore.read(Report.self, from: reportFile) }
    /// When the extension last said hello.
    static var contact: Date? { SharedStore.read(Date.self, from: contactFile) }
    static func noteContact() { SharedStore.write(Date.now, to: contactFile) }

    /// nil forgets what was there.
    static func store(_ connection: ModelConnection?, account: String = "safari") -> OSStatus {
        let removed = SecItemDelete(query(account) as CFDictionary)
        guard let connection else { return removed == errSecItemNotFound ? errSecSuccess : removed }
        guard let data = try? JSONEncoder().encode(connection) else { return errSecParam }
        var item = query(account)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil)
    }

    @discardableResult
    static func save(_ connection: ModelConnection?, account: String = "safari") -> Bool { store(connection, account: account) == errSecSuccess }

    static func load(account: String = "safari") -> ModelConnection? {
        var wanted = query(account)
        wanted[kSecReturnData as String] = true
        wanted[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(wanted as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
        return try? JSONDecoder().decode(ModelConnection.self, from: data)
    }

    /// The extension's message: `{type: "model", connection: {...} | null}`.
    static func handle(_ message: [String: Any]) -> [String: Any] {
        guard SharedStore.isShared else { return ["ok": false, "error": "no shared folder"] }
        func end(_ problem: String) -> [String: Any] {
            SharedStore.write(Report(date: .now, problem: problem), to: reportFile)
            return problem.isEmpty ? ["ok": true] : ["ok": false, "error": problem]
        }
        if message["type"] as? String == "model-error" { return end("extension: " + String((message["error"] as? String ?? "").prefix(200))) }
        var connection: ModelConnection?
        if let given = message["connection"] as? [String: Any] {
            guard let data = try? JSONSerialization.data(withJSONObject: given), data.count < 40_000,
                  let read = try? JSONDecoder().decode(ModelConnection.self, from: data) else { return end("unreadable") }
            connection = read
        }
        let status = store(connection)
        if status != errSecSuccess { return end("keychain \(status)") }
        if connection != nil { return end("") }
        SharedStore.write(Report(date: .now, problem: "no model in the extension"), to: reportFile)
        return ["ok": true]
    }
}
