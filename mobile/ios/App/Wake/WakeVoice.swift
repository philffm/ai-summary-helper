import AVFoundation
import NaturalLanguage
import Observation

/// Reads the wake screen's stories one after the other. Sounds with the silent switch on, like the alarm that led here.
@MainActor
@Observable
final class WakeVoice: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var index = 0
    private(set) var speaking = false
    /// The sentence being said, so that it can be lit up in the text.
    private(set) var sentence = ""
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var stories: [[String]] = []
    @ObservationIgnored private var last: AVSpeechUtterance?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// `stories`: for each one the pieces to say.
    func start(_ stories: [[String]]) {
        self.stories = stories
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        play(0)
    }

    func play(_ next: Int) {
        last = nil
        synthesizer.stopSpeaking(at: .immediate)
        guard stories.indices.contains(next) else { speaking = false; return }
        index = next
        speaking = true
        let voice = Voices.voice(for: stories[next].joined(separator: " "))
        for piece in stories[next].flatMap(Self.sentences) {
            let utterance = AVSpeechUtterance(string: piece)
            utterance.voice = voice
            utterance.postUtteranceDelay = 0.25
            last = utterance
            synthesizer.speak(utterance)
        }
    }

    func toggle() {
        if synthesizer.isPaused { synthesizer.continueSpeaking(); speaking = true }
        else if speaking { synthesizer.pauseSpeaking(at: .word); speaking = false }
        else { play(index) }
    }

    func stop() {
        last = nil
        sentence = ""
        synthesizer.stopSpeaking(at: .immediate)
        speaking = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// The sentences of a text as the system splits them, in any language.
    nonisolated static func sentences(_ text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        let found = tokenizer.tokens(for: text.startIndex..<text.endIndex).map { text[$0].trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return found.isEmpty ? [text] : found
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart started: AVSpeechUtterance) {
        let words = started.speechString
        Task { @MainActor in sentence = words }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish finished: AVSpeechUtterance) {
        let done = ObjectIdentifier(finished)
        Task { @MainActor in
            guard let last, ObjectIdentifier(last) == done else { return }
            if index + 1 < stories.count { play(index + 1) } else { speaking = false }
        }
    }
}
