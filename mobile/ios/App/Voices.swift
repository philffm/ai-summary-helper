import AVFoundation
import NaturalLanguage

/// The voice a text is read with: one of the text's own language.
enum Voices {
    struct Voice: Equatable {
        let id: String
        /// "de-DE"
        let language: String
        /// 1 as it comes with the device, higher for the better ones a reader has loaded.
        let quality: Int
    }

    /// The identifier of the voice to use, or nil for the one the reader's device is set to: where the text is in that
    /// language, or no voice speaks the text's.
    /// `device`: the device's speech language; `preferred`: the reader's languages; `standard`: the system's voice of a language.
    static func choose(for text: String, from voices: [Voice], device: String, preferred: [String], standard: (String) -> String?) -> String? {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(text.prefix(4000)))
        guard let found = recognizer.dominantLanguage?.rawValue else { return nil }
        // "zh-Hans" is spoken as "zh-CN": the script says which region where the reader names none
        let language = String(found.prefix { $0 != "-" })
        let usual = Locale.Language(identifier: found).maximalIdentifier.split(separator: "-").last.map(String.init) ?? ""
        let chinese = language == "zh"
        if device.hasPrefix(language + "-") && (!chinese || device.hasSuffix(usual)) { return nil }
        // the region the reader knows the language from, as in "en-GB"
        let known = preferred.first { $0.hasPrefix(language + "-") && (!chinese || $0.contains(found)) }
            .flatMap { Locale.Language(identifier: $0).region?.identifier }
        let wanted = language + "-" + (known ?? usual)
        let fitting = voices.filter { $0.language.hasPrefix(language + "-") && (!chinese || $0.language == wanted) }
        // a better voice the reader has loaded comes before the usual one, one of the wanted region before the others
        let best = fitting.max { ($0.quality, $0.language == wanted ? 1 : 0) < ($1.quality, $1.language == wanted ? 1 : 0) }
        guard let best else { return nil }
        if best.quality > 1 { return best.id }
        return standard(wanted) ?? fitting.first { $0.language == wanted }?.id ?? best.id
    }

    static func voice(for text: String) -> AVSpeechSynthesisVoice? {
        // voices made for fun are no readers
        let installed = AVSpeechSynthesisVoice.speechVoices().filter { voice in
            if #available(iOS 17.0, *), voice.voiceTraits.contains(.isNoveltyVoice) { return false }
            return true
        }
        let chosen = choose(for: text, from: installed.map { Voice(id: $0.identifier, language: $0.language, quality: $0.quality.rawValue) },
                            device: AVSpeechSynthesisVoice.currentLanguageCode(), preferred: Locale.preferredLanguages,
                            standard: { AVSpeechSynthesisVoice(language: $0)?.identifier })
        return chosen.flatMap(AVSpeechSynthesisVoice.init(identifier:))
    }
}
