import Foundation
import Observation

/// What the "Sync" screen shows and does: join the library the browser made, fetch it, leave it.
@MainActor
@Observable
final class SyncModel {
    enum Problem: Equatable {
        case notACode, wrongWords, noLibrary, login, needsHTTPS
        /// A folder in iCloud Drive whose files are not all here yet.
        case onItsWay
        /// Whatever else, in the words it came in.
        case other(String)

        init(_ error: Error) { self.init(said: "\(error)") }

        init(said: String) {
            if said.contains("still downloading") { self = .onItsWay }
            else if said.contains("not a Kaivo library code") { self = .notACode }
            else if said.contains("Wrong passphrase") { self = .wrongWords }
            else if said.contains("no Kaivo library") { self = .noLibrary }
            else if said.contains("401") || said.contains("403") || said.contains("username and password") { self = .login }
            else if said.contains("HTTPS is required") || said.contains("start with https") { self = .needsHTTPS }
            else { self = .other(said.replacingOccurrences(of: "Error: ", with: "")) }
        }
    }

    /// A code that has been read and waits for the yes.
    struct Offer: Equatable {
        var code: String
        var info: LibrarySync.Code
    }

    private(set) var state: LibrarySync.State?
    var offer: Offer?
    var passphrase = ""
    /// A chosen folder that waits for the passphrase.
    @ObservationIgnored private var chosen: Data?
    /// While a library is joined and fetched for the first time.
    private(set) var joining = false
    private(set) var fetching = false
    private(set) var progress: (done: Int, total: Int)?
    /// The run is sending what changed here.
    private(set) var sending = false
    /// Something changed here while a run was going: another one follows.
    @ObservationIgnored private var again = false
    @ObservationIgnored private var limited = false
    /// Takes the library's feed list, after a run that read it.
    @ObservationIgnored var takeFeeds: (([LibrarySync.FeedEntry]) -> Void)?
    var problem: Problem?
    /// The screen is asked for from outside (a scanned code).
    var shown = false

    @ObservationIgnored private let library: Library
    private var sync: LibrarySync? { library.store?.sync }
    var available: Bool { sync != nil }

    init(library: Library) { self.library = library }

    func refresh() async {
        guard let sync else { return }
        state = try? await sync.state()
    }

    /// A code from the clipboard or the camera.
    func read(_ code: String) async {
        guard let sync else { return }
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        problem = nil
        if let info = try? await sync.look(code) {
            offer = Offer(code: code, info: info)
            passphrase = ""
        } else {
            offer = nil
            problem = .notACode
        }
    }

    /// A folder chosen in Files: shown, like a code, before anything is joined.
    func read(folder: URL) async {
        guard sync != nil else { return }
        problem = nil
        offer = nil
        passphrase = ""
        guard let root = PlaceFolder.root(in: folder), let bookmark = try? PlaceFolder.bookmark(for: folder) else {
            problem = .noLibrary
            return
        }
        chosen = bookmark
        offer = Offer(code: "", info: LibrarySync.Code(service: "folder", server: folder.lastPathComponent, folder: root, words: false, plain: false))
    }

    func back() {
        chosen = nil
        offer = nil
        passphrase = ""
        problem = nil
    }

    func connect() async {
        guard let sync, let offer, !fetching else { return }
        problem = nil
        joining = true
        defer { joining = false }
        do {
            // everything the app has so far is in the library before the server's values meet it
            await library.settled()
            if offer.info.service == "folder", let chosen {
                try await sync.joinFolder(bookmark: chosen, root: offer.info.folder, name: offer.info.server, passphrase: passphrase)
            } else {
                try await sync.join(code: offer.code, passphrase: passphrase)
            }
        } catch {
            problem = Problem(error)
            return
        }
        self.offer = nil
        passphrase = ""
        await fetch()
    }

    /// One run, if a library is joined. What it brought is shown afterwards. `seconds`: no longer than about this; the
    /// rest comes with the next run.
    func fetch(seconds: Double? = nil) async {
        guard let sync else { return }
        guard !fetching else {
            // asked without a limit while a short run is going: the rest follows it
            if seconds == nil && limited { again = true }
            return
        }
        await refresh()
        guard state != nil else { return }
        // the system has already taken its time back
        guard seconds == nil || !Task.isCancelled else { return }
        fetching = true
        limited = seconds != nil
        problem = nil
        let watch = Task { [weak self] in
            var shown = 0, at = ContinuousClock.now
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled, let running = try? await sync.state()?.last?.running else { continue }
                self?.progress = (running.done, running.total)
                self?.sending = running.phase == "uploading"
                // what has arrived shows while the rest is on its way; what was read before is not read again
                if running.done != shown, ContinuousClock.now - at >= .seconds(2) {
                    shown = running.done
                    at = .now
                    self?.library.reload()
                }
            }
        }
        // a run that broke off may have brought a part
        var brought = true
        do {
            let run = try await withTaskCancellationHandler {
                try await sync.run(seconds: seconds)
            } onCancel: {
                Task { await sync.stop() }
            }
            brought = run.applied > 0 || (run.moved ?? 0) > 0
            if let list = run.feeds, !list.isEmpty { takeFeeds?(list) }
            if let first = run.errors.first { problem = Problem(said: first) }
        } catch {
            problem = Problem(error)
        }
        watch.cancel()
        progress = nil
        sending = false
        // reading a large library again takes a moment: only when there is something new
        if brought { library.reload() }
        await library.settled()
        await refresh()
        fetching = false
        if again {
            again = false
            // after a short run nothing waits for it: the system counts that run's time
            if seconds == nil { await fetch() } else if !Task.isCancelled { Task { await fetch() } }
        }
    }

    /// Something was saved or summarized here: where the app writes back, it goes out now and not at the next start.
    func changedHere() async {
        await library.settled()
        if state == nil { await refresh() }
        guard state?.writesBack == true else { return }
        if fetching { again = true } else { await fetch() }
    }

    /// What switching on writing back would add to the library.
    func waiting() async -> LibrarySync.Waiting? {
        await library.settled()
        return try? await sync?.waiting()
    }

    /// Switched on, a run follows at once and sends what changed here.
    func setWriteBack(_ on: Bool) async {
        guard let sync else { return }
        while fetching { try? await Task.sleep(for: .milliseconds(200)) }
        do { try await sync.setWriteBack(on) } catch { problem = Problem(error) }
        await refresh()
        if on { await fetch() }
    }

    func leave() async {
        guard let sync else { return }
        // a run that is going on ends first: the tap must not get lost
        while fetching { try? await Task.sleep(for: .milliseconds(200)) }
        do { try await sync.leave() } catch { problem = Problem(error) }
        await refresh()
    }
}
