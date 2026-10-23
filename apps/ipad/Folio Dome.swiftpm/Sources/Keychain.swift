// API keys, in the iPad's Keychain (this device only). The page never reads them: it is told
// whether a key exists, and requests carry a stand-in ("folio-keychain-<name>", see
// apps/ipad/src/http.ts) that HttpProxy replaces with the key as the request leaves.

import Foundation
import Security

enum Keychain {
    private static let service = "Folio Dome"

    private static func query(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }

    static func get(_ name: String) -> String? {
        var q = query(name)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ name: String, _ value: String?) throws {
        SecItemDelete(query(name) as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var q = query(name)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status != errSecSuccess { throw BridgeError("The key could not be saved in the Keychain (error \(status)).") }
    }

    private static let token = try! NSRegularExpression(pattern: "folio-keychain-([A-Za-z0-9._%-]+)")

    /** The header value with each key stand-in replaced by the key (left as is when there is no such key). */
    static func substitute(_ value: String) -> String {
        let ns = value as NSString
        var out = value
        for match in token.matches(in: value, range: NSRange(location: 0, length: ns.length)).reversed() {
            let encoded = ns.substring(with: match.range(at: 1))
            guard let name = encoded.removingPercentEncoding, let key = get(name) else { continue }
            out = (out as NSString).replacingCharacters(in: match.range, with: key)
        }
        return out
    }
}
