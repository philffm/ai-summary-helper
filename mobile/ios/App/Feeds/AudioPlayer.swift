import AVFoundation
import MediaPlayer
import Observation
import SwiftUI

/// Plays podcast episodes: goes on with the screen locked, and the lock screen and headphones control it.
@MainActor
@Observable
final class AudioPlayer {
    static let shared = AudioPlayer()

    private(set) var current: String?
    private(set) var playing = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var clock: Any?
    @ObservationIgnored private var title = ""
    @ObservationIgnored private var show = ""
    @ObservationIgnored private var wired = false

    func toggle(_ id: String, url: URL, title: String, show: String) {
        if current == id { playing ? pause() : resume(); return }
        stop()
        self.title = title
        self.show = show
        current = id
        let next = AVPlayer(url: url)
        player = next
        clock = next.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time) }
        }
        wireControls()
        resume()
    }

    func resume() {
        guard let player else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        playing = true
        publish()
    }

    func pause() {
        player?.pause()
        playing = false
        publish()
    }

    func seek(to seconds: Double) {
        guard let player else { return }
        position = max(0, duration > 0 ? min(seconds, duration) : seconds)
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600))
        publish()
    }

    func skip(_ seconds: Double) { seek(to: position + seconds) }

    func stop() {
        if let clock { player?.removeTimeObserver(clock) }
        clock = nil
        player?.pause()
        player = nil
        current = nil
        playing = false
        position = 0
        duration = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func tick(_ time: CMTime) {
        position = time.seconds.isFinite ? time.seconds : 0
        let length = player?.currentItem?.duration.seconds ?? 0
        if length.isFinite && length > 0 && length != duration { duration = length; publish() }
        // at the end it stops; nothing starts by itself
        if duration > 0 && position >= duration - 0.3 && playing { pause(); seek(to: 0) }
    }

    private func publish() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: show, MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
    }

    private func wireControls() {
        guard !wired else { return }
        wired = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.resume() }; return .success }
        center.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.pause() }; return .success }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.skip(-15) }; return .success }
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipForwardCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.skip(30) }; return .success }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let time = event.positionTime
            MainActor.assumeIsolated { self?.seek(to: time) }
            return .success
        }
    }
}

/// The controls of an episode, shown in its feed item.
struct EpisodePlayer: View {
    let id: String
    let url: URL
    let title: String
    let show: String
    @Environment(Speaker.self) private var speaker
    private var player: AudioPlayer { .shared }
    @State private var dragged: Double?

    var body: some View {
        let mine = player.current == id
        let position = mine ? dragged ?? player.position : 0
        let duration = mine ? player.duration : 0
        VStack(spacing: 10) {
            Slider(value: Binding(get: { position }, set: { dragged = $0 }), in: 0...max(1, duration)) { editing in
                if !editing, let to = dragged { player.seek(to: to); dragged = nil }
            }
            .disabled(duration == 0)
            .accessibilityLabel("Position")
            HStack {
                Text(verbatim: Self.time(position))
                Spacer()
                Text(verbatim: duration > 0 ? "−" + Self.time(duration - position) : "")
            }
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            HStack(spacing: 34) {
                Button { player.skip(-15) } label: { Image(systemName: "gobackward.15").font(.title2) }
                    .disabled(!mine).accessibilityLabel("Back 15 seconds")
                Button {
                    speaker.stop()
                    player.toggle(id, url: url, title: title, show: show)
                } label: {
                    Image(systemName: mine && player.playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 62))
                }
                .accessibilityLabel(mine && player.playing ? Text("Pause") : Text("Play"))
                Button { player.skip(30) } label: { Image(systemName: "goforward.30").font(.title2) }
                    .disabled(!mine).accessibilityLabel("Forward 30 seconds")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(KaivoTokens.accent)
        .padding(18)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    static func time(_ seconds: Double) -> String {
        let all = Int(max(0, seconds.isFinite ? seconds : 0))
        return all >= 3600 ? String(format: "%d:%02d:%02d", all / 3600, all / 60 % 60, all % 60) : String(format: "%d:%02d", all / 60, all % 60)
    }
}
