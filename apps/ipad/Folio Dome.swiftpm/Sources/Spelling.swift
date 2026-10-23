// Spelling for the editor's underlines and suggestions, with the system dictionary.

import UIKit

@MainActor
enum Spelling {
    private static let checker = UITextChecker()

    private static var language: String {
        let available = UITextChecker.availableLanguages
        for preferred in Locale.preferredLanguages {
            let code = preferred.replacingOccurrences(of: "-", with: "_")
            if available.contains(code) { return code }
            if let match = available.first(where: { $0.hasPrefix(String(code.prefix(2))) }) { return match }
        }
        return available.contains("en_US") ? "en_US" : (available.first ?? "en_US")
    }

    static func misspelled(_ words: [String]) -> [String] {
        let lang = language
        return words.filter { word in
            let range = checker.rangeOfMisspelledWord(in: word, range: NSRange(location: 0, length: (word as NSString).length), startingAt: 0, wrap: false, language: lang)
            return range.location != NSNotFound
        }
    }

    static func guesses(_ word: String) -> [String] {
        checker.guesses(forWordRange: NSRange(location: 0, length: (word as NSString).length), in: word, language: language) ?? []
    }

    static func learn(_ word: String) {
        UITextChecker.learnWord(word)
    }
}
