import CryptoKit
import Foundation
import Observation

/// A podcast episode that was loaded to this device, or is on its way.
struct Episode: Codable, Equatable, Identifiable {
    /// The feed entry's id.
    var id: String
    var title: String
    var show: String
    var address: String
    /// The file's name in the folder; nil while it is on its way.
    var file: String?
    var bytes: Int64 = 0
    var added = Date.now
}

/// How far an episode was listened to.
struct Listening: Codable, Equatable {
    var at: Double = 0
    var of: Double = 0
    var heard = false
    /// When it was last listened to.
    var when: Date?
}

/// The episodes kept on this device and how far each was heard. Both stay here: not synced, not in a backup.
@MainActor
@Observable
final class PodcastStore {
    enum State: Equatable {
        case none
        /// Asked for, and held back until there is Wi-Fi.
        case waiting
        case loading(done: Int64, total: Int64)
        case loaded(Int64)
        case failed
    }

    static let wifiKey = "podcastWifiOnly", removeKey = "podcastRemoveHeard"
    static let shared: PodcastStore = {
        let folder = URL.applicationSupportDirectory.appending(path: "podcasts", directoryHint: .isDirectory)
        return PodcastStore(folder: folder, downloader: BackgroundDownloader(folder: folder))
    }()

    private struct Saved: Codable { var episodes: [String: Episode] = [:]; var listening: [String: Listening] = [:] }

    private var saved = Saved()
    /// Bytes arrived and expected, of the downloads that are going.
    private var progress: [String: (done: Int64, total: Int64)] = [:]
    private var failed: Set<String> = []
    /// Downloads started on mobile data on purpose.
    private var anyway: Set<String> = []
    /// The network is one a Wi-Fi-only download does not use.
    private(set) var offWifi = false
    @ObservationIgnored let folder: URL
    @ObservationIgnored private let downloader: EpisodeDownloader
    @ObservationIgnored private let settings: UserDefaults

    init(folder: URL, downloader: EpisodeDownloader, settings: UserDefaults = .standard) {
        self.folder = folder
        self.downloader = downloader
        self.settings = settings
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var excluded = folder
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? excluded.setResourceValues(values)
        if let data = try? Data(contentsOf: index), let read = try? JSONDecoder().decode(Saved.self, from: data) { saved = read }
        downloader.events = { [weak self] in self?.take($0) }
        downloader.offWifi = { [weak self] in self?.offWifi = $0 }
        downloader.begin()
        Task { await settle() }
    }

    private var index: URL { folder.appending(path: "episodes.json") }
    private func save() { if let data = try? JSONEncoder().encode(saved) { try? data.write(to: index, options: .atomic) } }

    var wifiOnly: Bool { settings.object(forKey: Self.wifiKey) as? Bool ?? true }
    var removesHeard: Bool { settings.bool(forKey: Self.removeKey) }

    /// What is on this device, the latest first.
    var loaded: [Episode] { saved.episodes.values.filter { $0.file != nil }.sorted { ($1.added, $0.id) < ($0.added, $1.id) } }
    var totalBytes: Int64 { loaded.reduce(0) { $0 + $1.bytes } }
    var heardBytes: Int64 { loaded.filter { listening($0.id).heard }.reduce(0) { $0 + $1.bytes } }
    /// Kept in its feed, however old it gets.
    func keeps(_ id: String) -> Bool { saved.episodes[id] != nil }

    func state(_ id: String) -> State {
        if let episode = saved.episodes[id], episode.file != nil { return .loaded(episode.bytes) }
        if failed.contains(id) { return .failed }
        guard saved.episodes[id] != nil else { return .none }
        let so = progress[id] ?? (0, 0)
        if so.done == 0 && offWifi && wifiOnly && !anyway.contains(id) { return .waiting }
        return .loading(done: so.done, total: so.total)
    }

    /// The file of a loaded episode.
    func file(_ id: String) -> URL? {
        guard let name = saved.episodes[id]?.file else { return nil }
        let url = folder.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// `mobile`: on mobile data too, whatever the setting says.
    func load(_ id: String, title: String, show: String, url: URL, mobile: Bool = false) {
        if saved.episodes[id]?.file != nil { return }
        failed.remove(id)
        progress[id] = nil
        if mobile { anyway.insert(id) } else { anyway.remove(id) }
        saved.episodes[id] = Episode(id: id, title: title, show: show, address: url.absoluteString)
        save()
        downloader.start(id, url: url, mobile: mobile || !wifiOnly)
    }

    /// Cancels a download, or removes a loaded episode.
    func remove(_ id: String) {
        downloader.cancel(id)
        if let file = file(id) { try? FileManager.default.removeItem(at: file) }
        saved.episodes[id] = nil
        progress[id] = nil
        failed.remove(id)
        anyway.remove(id)
        save()
    }

    /// The heard ones go; `playing` stays, heard or not.
    func removeHeard(except playing: String?) {
        for episode in loaded where episode.id != playing && listening(episode.id).heard { remove(episode.id) }
    }

    // MARK: - Listening

    func listening(_ id: String) -> Listening { saved.listening[id] ?? Listening() }

    /// Where to go on, nil from the start.
    func resumeAt(_ id: String) -> Double? {
        let l = listening(id)
        return l.at > 5 && (l.of <= 0 || l.at < l.of - 10) ? l.at : nil
    }

    func heard(_ id: String, at: Double, of: Double) {
        var l = listening(id)
        l.at = at
        l.when = .now
        if of > 0 { l.of = of }
        // the last half minute is mostly goodbyes
        if l.of > 60 && at >= l.of - 30 { l.heard = true }
        saved.listening[id] = l
        save()
    }

    /// Played to its end. → whether its file is to go now (the setting says so)
    @discardableResult
    func finished(_ id: String) -> Bool {
        var l = listening(id)
        l.at = 0
        l.heard = true
        saved.listening[id] = l
        save()
        return removesHeard && file(id) != nil
    }

    /// The episodes that were started and not finished, the one listened to last first.
    var started: [String] {
        saved.listening.keys.filter { resumeAt($0) != nil }.sorted { (listening($0).when ?? .distantPast) > (listening($1).when ?? .distantPast) }
    }

    /// The title and show of a loaded episode, for one whose feed no longer names it.
    func episode(_ id: String) -> Episode? { saved.episodes[id] }

    // MARK: - Downloads

    private func take(_ event: DownloadEvent) {
        switch event {
        case .progress(let id, let done, let total):
            if saved.episodes[id] != nil { progress[id] = (done, total) }
        case .finished(let id, let name, let bytes):
            // removed while it arrived: the file goes too
            guard saved.episodes[id] != nil else { try? FileManager.default.removeItem(at: folder.appending(path: name)); return }
            saved.episodes[id]?.file = name
            saved.episodes[id]?.bytes = bytes
            progress[id] = nil
            failed.remove(id)
            save()
        case .failed(let id):
            guard saved.episodes[id]?.file == nil, saved.episodes[id] != nil else { return }
            progress[id] = nil
            failed.insert(id)
        }
    }

    /// After a start: what was on its way and is not any more has failed; a file that is gone is no loaded episode.
    func settle() async {
        let going = await downloader.running()
        for (id, episode) in saved.episodes {
            if episode.file != nil {
                if file(id) == nil { saved.episodes[id] = nil }
            } else if !going.contains(id) { failed.insert(id) }
        }
        save()
    }

    /// A name that stays the same for an episode, with the extension the player needs.
    nonisolated static func fileName(_ id: String, url: URL?, mime: String?) -> String {
        let hex = SHA256.hash(data: Data(id.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        let known = ["mp3", "m4a", "aac", "mp4", "wav"]
        let from = url?.pathExtension.lowercased() ?? ""
        if known.contains(from) { return hex + "." + from }
        switch mime?.lowercased() {
        case "audio/mp4", "audio/x-m4a", "audio/m4a": return hex + ".m4a"
        case "audio/aac": return hex + ".aac"
        case "audio/wav", "audio/x-wav": return hex + ".wav"
        default: return hex + ".mp3"
        }
    }
}
