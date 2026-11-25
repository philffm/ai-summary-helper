import AVFoundation
import Observation

/// Reads text aloud with the system voice.
@Observable
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    /// What is being read (an id chosen by the caller), or nil.
    private(set) var current: String?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var utterance: AVSpeechUtterance?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func toggle(_ id: String, text: String) {
        let stopOnly = current == id
        synthesizer.stopSpeaking(at: .immediate)
        current = nil
        utterance = nil
        guard !stopOnly else { return }
        let next = AVSpeechUtterance(string: text)
        utterance = next
        current = id
        synthesizer.speak(next)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish finished: AVSpeechUtterance) {
        DispatchQueue.main.async {
            // a late callback of an earlier text must not reset the one that is playing now
            guard finished === self.utterance else { return }
            self.current = nil
        }
    }
}
