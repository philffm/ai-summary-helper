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

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        current = nil
        utterance = nil
    }

    /// The paces offered, and what the system's voice is set to for each: its scale is not linear.
    static let paces: [(factor: Double, rate: Float)] = [(0.8, 0.44), (1, AVSpeechUtteranceDefaultSpeechRate), (1.25, 0.54), (1.5, 0.58)]
    static let paceKey = "speechPace"

    func toggle(_ id: String, text: String) {
        let stopOnly = current == id
        synthesizer.stopSpeaking(at: .immediate)
        current = nil
        utterance = nil
        guard !stopOnly else { return }
        let next = AVSpeechUtterance(string: text)
        let chosen = UserDefaults.standard.object(forKey: Self.paceKey) as? Double ?? 1
        next.rate = Self.paces.first { $0.factor == chosen }?.rate ?? AVSpeechUtteranceDefaultSpeechRate
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
