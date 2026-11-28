import Foundation

/// Tells when something new waits in a hand-over folder while the app is in front: Safari and the share sheet write
/// there at any time, and Safari often a few seconds after the reader has already come over.
@MainActor
final class InboxWatch {
    private var sources: [DispatchSourceFileSystemObject] = []
    private var waiting: Task<Void, Never>?
    /// Since when something has been arriving without being told.
    private var since: ContinuousClock.Instant?
    private let quiet: Duration

    /// `quiet`: so long nothing new has to arrive before it is told. Safari writes an article's pictures and then
    /// its text, and a whole library file by file.
    init(quiet: Duration = .milliseconds(700)) { self.quiet = quiet }

    var isWatching: Bool { !sources.isEmpty }

    func start(_ folders: [URL], changed: @escaping @MainActor () -> Void) {
        stop()
        for folder in folders {
            let file = open(folder.path, O_EVTONLY)
            guard file >= 0 else { continue }
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: file, eventMask: .write, queue: .main)
            source.setEventHandler { [weak self] in
                MainActor.assumeIsolated { self?.later(changed) }
            }
            source.setCancelHandler { close(file) }
            source.resume()
            sources.append(source)
        }
    }

    func stop() {
        sources.forEach { $0.cancel() }
        sources = []
        waiting?.cancel()
        waiting = nil
        since = nil
    }

    private func later(_ changed: @escaping @MainActor () -> Void) {
        waiting?.cancel()
        let first = since ?? .now
        since = first
        // a long hand-over is shown while it goes on, not only at its end
        let wait = ContinuousClock.now - first > .seconds(3) ? .zero : quiet
        waiting = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled else { return }
            self?.since = nil
            changed()
        }
    }
}
