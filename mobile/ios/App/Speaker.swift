import AVFoundation
import NaturalLanguage
import Observation

/// Reads text aloud with a voice of the text's language. It goes on with the screen locked, ignores the mute switch as
/// other spoken audio does, and tells which sentence it is at.
@MainActor
@Observable
final class Speaker: NSObject, AVSpeechSynthesizerDelegate, Listenable {
    /// One piece of what is read; `passage` where it is a paragraph of an article.
    struct Part: Equatable {
        var passage: Passage.ID?
        var text: String
    }

    /// The sentence being read, inside its paragraph (UTF-16 units).
    struct Spoken: Equatable {
        var id: String
        var passage: Passage.ID
        var sentence: NSRange
    }

    /// What is being read (an id chosen by the caller), or nil.
    private(set) var current: String?
    private(set) var paused = false
    private(set) var spoken: Spoken?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var utterance: AVSpeechUtterance?
    @ObservationIgnored private var parts: [Part] = []
    @ObservationIgnored private var title = ""

    override init() {
        super.init()
        synthesizer.delegate = self
        let center = NotificationCenter.default
        // a call or another app takes the sound: wait, and go on if the system says so
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            let resume = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0).contains(.shouldResume)
            MainActor.assumeIsolated {
                if began { self?.remotePause() } else if resume { self?.remotePlay() }
            }
        }
        // headphones pulled out: nothing goes on aloud
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            MainActor.assumeIsolated { self?.remotePause() }
        }
    }

    func stop() {
        let was = current != nil
        synthesizer.stopSpeaking(at: .immediate)
        clear()
        if was { end() }
    }

    /// The paces offered, and what the system's voice is set to for each: its scale is not linear.
    static let paces: [(factor: Double, rate: Float)] = [(0.8, 0.44), (1, AVSpeechUtteranceDefaultSpeechRate), (1.25, 0.54), (1.5, 0.58)]
    static let paceKey = "speechPace"

    func toggle(_ id: String, text: String, title: String = "Kaivo") {
        toggle(id, parts: [Part(passage: nil, text: text)], title: title)
    }

    /// Starts reading; for what is being read already: goes on if paused, else stops.
    func toggle(_ id: String, parts: [Part], title: String) {
        if current == id {
            if paused { remotePlay() } else { stop() }
            return
        }
        synthesizer.stopSpeaking(at: .immediate)
        clear()
        let text = parts.map(\.text).joined(separator: " ")
        let next = AVSpeechUtterance(string: text)
        next.voice = Voices.voice(for: text)
        let chosen = UserDefaults.standard.object(forKey: Self.paceKey) as? Double ?? 1
        next.rate = Self.paces.first { $0.factor == chosen }?.rate ?? AVSpeechUtteranceDefaultSpeechRate
        utterance = next
        current = id
        self.parts = parts
        self.title = title
        activate()
        synthesizer.speak(next)
        show()
    }

    private func clear() {
        current = nil
        utterance = nil
        spoken = nil
        paused = false
        parts = []
    }

    private func activate() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        NowPlaying.shared.claim(self)
    }

    /// Done reading: the sound goes back to whoever had it.
    private func end() {
        guard NowPlaying.shared.owner === self else { return }
        NowPlaying.shared.release(self)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func show() { NowPlaying.shared.show(self, title: title, artist: "Kaivo") }

    // MARK: - From outside

    var seeks: Bool { false }
    var isPlaying: Bool { current != nil && !paused }

    func remotePlay() {
        guard current != nil, paused else { return }
        activate()
        synthesizer.continueSpeaking()
        paused = false
        show()
    }

    func remotePause() {
        guard current != nil, !paused else { return }
        synthesizer.pauseSpeaking(at: .word)
        paused = true
        show()
    }

    func remoteSkip(_ seconds: Double) {}
    func remoteSeek(_ seconds: Double) {}

    // MARK: - Where it is

    /// The part a place of the joined text lies in, and the sentence around it, inside that part.
    nonisolated static func place(of location: Int, in texts: [String]) -> (part: Int, sentence: NSRange)? {
        var start = 0
        for (index, text) in texts.enumerated() {
            let length = text.utf16.count
            if location < start + length {
                guard location >= start, let at = Range(NSRange(location: location - start, length: 0), in: text)?.lowerBound else { return nil }
                let tokenizer = NLTokenizer(unit: .sentence)
                tokenizer.string = text
                var found = tokenizer.tokenRange(at: at)
                if found.isEmpty { found = text.startIndex..<text.endIndex }
                // without the space after it
                while found.upperBound > found.lowerBound, text[text.index(before: found.upperBound)].isWhitespace { found = found.lowerBound..<text.index(before: found.upperBound) }
                return (index, NSRange(found, in: text))
            }
            start += length + 1
        }
        return nil
    }

    private func reached(_ location: Int) {
        guard let current, let place = Self.place(of: location, in: parts.map(\.text)), let passage = parts[place.part].passage else {
            if spoken != nil { spoken = nil }
            return
        }
        let now = Spoken(id: current, passage: passage, sentence: place.sentence)
        if spoken != now { spoken = now }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance speaking: AVSpeechUtterance) {
        let id = ObjectIdentifier(speaking)
        Task { @MainActor in
            guard let utterance, ObjectIdentifier(utterance) == id else { return }
            reached(range.location)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish finished: AVSpeechUtterance) {
        let id = ObjectIdentifier(finished)
        Task { @MainActor in
            // a late callback of an earlier text must not reset the one that is playing now
            guard let utterance, ObjectIdentifier(utterance) == id else { return }
            clear()
            end()
        }
    }
}
