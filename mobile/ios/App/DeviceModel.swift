import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// The language model Apple builds into newer devices (Apple Intelligence). The text never leaves the device.
enum DeviceModel {
    enum State: Equatable {
        case ready
        /// This device cannot run it.
        case notEligible
        /// Apple Intelligence is switched off.
        case off
        /// The system is still fetching the model.
        case loading
        /// Before iOS 26 there is none.
        case unsupported
    }

    enum Failure: LocalizedError, Equatable {
        case declined, language, tooLong, notReady
        case other(String)

        var errorDescription: String? {
            switch self {
            case .declined: String(localized: "The model on this device declined this text.")
            case .language: String(localized: "The model on this device does not support the language of this text.")
            case .tooLong: String(localized: "This text is too long for the model on this device.")
            case .notReady: String(localized: "The model on this device is not ready right now.")
            case .other(let said): said
            }
        }
    }

    static var state: State {
        if let forced = forced { return forced }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return .ready
            case .unavailable(.appleIntelligenceNotEnabled): return .off
            case .unavailable(.modelNotReady): return .loading
            case .unavailable: return .notEligible
            }
        }
        #endif
        return .unsupported
    }

    /// `-KaivoDeviceModel ready|off|loading|no` (debug builds): the screens for a state this machine does not have. With
    /// "ready" the answer is a made-up one.
    static var forced: State? {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "KaivoDeviceModel") {
        case "ready": .ready
        case "off": .off
        case "loading": .loading
        case "no": .notEligible
        default: nil
        }
        #else
        nil
        #endif
    }

    /// The model reads and writes about 4,000 tokens at a time. Latin text takes a token for every three or four
    /// characters, Chinese, Japanese or Korean nearly one each, so the parts of a long text are cut accordingly, and more
    /// of them are read.
    static func parts(for text: String) -> (size: Int, most: Int) {
        let sample = text.unicodeScalars.prefix(4000)
        let dense = sample.filter { (0x3040...0x30FF).contains($0.value) || (0x3400...0x9FFF).contains($0.value) || (0xAC00...0xD7AF).contains($0.value) }.count
        return dense > sample.count / 5 ? (1800, 8) : (5000, 6)
    }

    static func ask(system: String, user: String) async throws -> String {
        #if DEBUG
        if forced == .ready { return "- A made-up summary, written without a model.\n- It stands in where this machine has none." }
        #endif
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            do {
                let session = LanguageModelSession(instructions: system)
                return try await session.respond(to: user, options: GenerationOptions(temperature: 0.3)).content
            } catch {
                throw failure(error)
            }
        }
        #endif
        throw Failure.notReady
    }

    #if canImport(FoundationModels)
    /// What the system says went wrong, as the app tells it. iOS 27 names the errors anew.
    @available(iOS 26.0, *)
    private static func failure(_ error: Error) -> Failure {
        if #available(iOS 27.0, *), let error = error as? LanguageModelError {
            switch error {
            case .contextSizeExceeded: return .tooLong
            case .guardrailViolation, .refusal: return .declined
            case .unsupportedLanguageOrLocale: return .language
            case .rateLimited: return .notReady
            default: return .other(error.localizedDescription)
            }
        }
        if let error = error as? LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize: return .tooLong
            case .guardrailViolation, .refusal: return .declined
            case .unsupportedLanguageOrLocale: return .language
            case .assetsUnavailable, .rateLimited, .concurrentRequests: return .notReady
            default: return .other(error.localizedDescription)
            }
        }
        return .other(error.localizedDescription)
    }
    #endif
}
