import Foundation
import Observation

/// What the "Sync" screen shows and does: join the library the browser made, fetch it, leave it.
@MainActor
@Observable
final class SyncModel {
    enum Problem: Equatable {
        case notACode, wrongWords, noLibrary, login, needsHTTPS
        /// Whatever else, in the words it came in.
        case other(String)

        init(_ error: Error) {
            let said = "\(error)"
            if said.contains("not a Kaivo library code") { self = .notACode }
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
    /// While a library is joined and fetched for the first time.
    private(set) var joining = false
    private(set) var fetching = false
    private(set) var progress: (done: Int, total: Int)?
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

    func back() {
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
            try await sync.join(code: offer.code, passphrase: passphrase)
        } catch {
            problem = Problem(error)
            return
        }
        self.offer = nil
        passphrase = ""
        await fetch()
    }

    /// One run, if a library is joined. What it brought is shown afterwards.
    func fetch() async {
        guard let sync, !fetching else { return }
        await refresh()
        guard state != nil else { return }
        fetching = true
        problem = nil
        let watch = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled, let running = try? await sync.state()?.last?.running else { continue }
                self?.progress = (running.done, running.total)
            }
        }
        // a run that broke off may have brought a part
        var brought = true
        do {
            let run = try await sync.run()
            brought = run.applied > 0 || (run.moved ?? 0) > 0
            if let first = run.errors.first { problem = .other(first) }
        } catch {
            problem = Problem(error)
        }
        watch.cancel()
        progress = nil
        // reading a large library again takes a moment: only when there is something new
        if brought { library.reload() }
        await library.settled()
        await refresh()
        fetching = false
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
