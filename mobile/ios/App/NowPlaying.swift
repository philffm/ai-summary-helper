import MediaPlayer

/// Something that can be heard and controlled from outside the app: the lock screen, headphones, a watch.
@MainActor
protocol Listenable: AnyObject {
    /// Whether it has a length to move in.
    var seeks: Bool { get }
    var isPlaying: Bool { get }
    func remotePlay()
    func remotePause()
    func remoteSkip(_ seconds: Double)
    func remoteSeek(_ seconds: Double)
}

/// The one place that talks to the system's "Now Playing": whoever started last owns it, and what played before pauses.
@MainActor
final class NowPlaying {
    static let shared = NowPlaying()
    private(set) weak var owner: Listenable?
    private var wired = false

    func claim(_ source: Listenable) {
        if let before = owner, before !== source { before.remotePause() }
        owner = source
        wire()
        let center = MPRemoteCommandCenter.shared()
        for command in [center.skipBackwardCommand, center.skipForwardCommand, center.changePlaybackPositionCommand] { command.isEnabled = source.seeks }
    }

    /// What is shown; only the owner is listened to.
    func show(_ source: Listenable, title: String, artist: String, duration: Double = 0, position: Double = 0) {
        guard owner === source else { return }
        var info: [String: Any] = [MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: artist,
                                   MPNowPlayingInfoPropertyPlaybackRate: source.isPlaying ? 1.0 : 0.0]
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func release(_ source: Listenable) {
        guard owner === source else { return }
        owner = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func wire() {
        guard !wired else { return }
        wired = true
        let center = MPRemoteCommandCenter.shared()
        func on(_ command: MPRemoteCommand, _ act: @escaping @MainActor (Listenable) -> Void) {
            command.addTarget { _ in
                MainActor.assumeIsolated {
                    guard let owner = NowPlaying.shared.owner else { return .noActionableNowPlayingItem }
                    act(owner)
                    return .success
                }
            }
        }
        on(center.playCommand) { $0.remotePlay() }
        on(center.pauseCommand) { $0.remotePause() }
        on(center.togglePlayPauseCommand) { $0.isPlaying ? $0.remotePause() : $0.remotePlay() }
        center.skipBackwardCommand.preferredIntervals = [15]
        on(center.skipBackwardCommand) { $0.remoteSkip(-15) }
        center.skipForwardCommand.preferredIntervals = [30]
        on(center.skipForwardCommand) { $0.remoteSkip(30) }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let time = event.positionTime
            MainActor.assumeIsolated { NowPlaying.shared.owner?.remoteSeek(time) }
            return .success
        }
    }
}
