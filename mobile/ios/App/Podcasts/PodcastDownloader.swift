import Foundation
import Network
import UIKit

enum DownloadEvent: Equatable {
    case progress(String, done: Int64, total: Int64)
    /// The file lies in the folder under `name`.
    case finished(String, name: String, bytes: Int64)
    case failed(String)
}

@MainActor
protocol EpisodeDownloader: AnyObject {
    var events: ((DownloadEvent) -> Void)? { get set }
    /// Told whether the network is one a Wi-Fi-only download does not use.
    var offWifi: ((Bool) -> Void)? { get set }
    func begin()
    /// `mobile`: mobile data may be used.
    func start(_ id: String, url: URL, mobile: Bool)
    func cancel(_ id: String)
    /// The ids whose downloads are going.
    func running() async -> [String]
}

/// Downloads that go on while the app is in the background, or gone: two sessions of the system, one that waits for Wi-Fi
/// and one that does not.
@MainActor
final class BackgroundDownloader: EpisodeDownloader {
    var events: ((DownloadEvent) -> Void)?
    var offWifi: ((Bool) -> Void)?
    private let folder: URL
    private var wifi: URLSession!
    private var any: URLSession!
    private let delegate: Delegate
    private let path = NWPathMonitor()
    /// The task that counts for an episode, among those started since the app is running.
    private var wanted: [String: (session: URLSession, task: Int)] = [:]

    nonisolated static var prefix: String { (Bundle.main.bundleIdentifier ?? "kaivo") + ".podcasts" }

    init(folder: URL) {
        self.folder = folder
        delegate = Delegate(folder: folder)
    }

    func begin() {
        delegate.tell = { [weak self] event in Task { @MainActor in self?.events?(event) } }
        func session(_ name: String, mobile: Bool) -> URLSession {
            let configuration = URLSessionConfiguration.background(withIdentifier: Self.prefix + name)
            configuration.allowsCellularAccess = mobile
            configuration.allowsExpensiveNetworkAccess = mobile
            configuration.sessionSendsLaunchEvents = true
            return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        }
        wifi = session(".wifi", mobile: false)
        any = session(".any", mobile: true)
        path.pathUpdateHandler = { [weak self] path in
            let off = path.status != .satisfied || path.isExpensive
            Task { @MainActor in self?.offWifi?(off) }
        }
        path.start(queue: .global(qos: .utility))
    }

    func start(_ id: String, url: URL, mobile: Bool) {
        let session: URLSession = mobile ? any : wifi
        let task = session.downloadTask(with: url)
        task.taskDescription = id
        wanted[id] = (session, task.taskIdentifier)
        task.resume()
        // one download for an episode: one that was waiting goes, when it is asked for on mobile data
        sweep(id)
    }

    func cancel(_ id: String) {
        wanted[id] = nil
        sweep(id)
    }

    /// Ends every task of an episode but the one that is wanted when the list is there: it comes later, and a download
    /// may have been started meanwhile.
    private func sweep(_ id: String) {
        Task {
            for session in [wifi, any].compactMap({ $0 }) {
                for task in await session.allTasks where task.taskDescription == id && task.state != .completed {
                    if let keep = wanted[id], keep.session === session, task.taskIdentifier == keep.task { continue }
                    task.taskDescription = nil
                    task.cancel()
                }
            }
        }
    }

    func running() async -> [String] {
        var out: [String] = []
        for session in [wifi, any] {
            guard let session else { continue }
            out += await session.allTasks.filter { $0.state == .running || $0.state == .suspended }.compactMap(\.taskDescription)
        }
        return out
    }

    private final class Delegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
        let folder: URL
        var tell: (@Sendable (DownloadEvent) -> Void)?

        init(folder: URL) { self.folder = folder }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytes: Int64, totalBytesWritten done: Int64, totalBytesExpectedToWrite total: Int64) {
            if let id = downloadTask.taskDescription { tell?(.progress(id, done: done, total: max(0, total))) }
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
            guard let id = downloadTask.taskDescription else { return }
            let response = downloadTask.response as? HTTPURLResponse
            // a page of a hotel's network or of an error is no episode
            guard (200..<300).contains(response?.statusCode ?? 200), response?.mimeType?.hasPrefix("text/") != true else {
                tell?(.failed(id))
                return
            }
            let name = PodcastStore.fileName(id, url: downloadTask.originalRequest?.url, mime: response?.mimeType)
            let target = folder.appending(path: name)
            // now: the system removes the file when this returns
            try? FileManager.default.removeItem(at: target)
            do {
                try FileManager.default.moveItem(at: location, to: target)
                let bytes = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
                tell?(.finished(id, name: name, bytes: bytes ?? 0))
            } catch {
                tell?(.failed(id))
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            guard let id = task.taskDescription, let error, (error as? URLError)?.code != .cancelled else { return }
            tell?(.failed(id))
        }

        func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
            Task { @MainActor in
                AppDelegate.finished.removeValue(forKey: session.configuration.identifier ?? "")?()
            }
        }
    }
}

/// Where the system says that downloads ended while the app was not running.
final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var finished: [String: () -> Void] = [:]

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        MainActor.assumeIsolated {
            AppDelegate.finished[identifier] = completionHandler
            // the sessions are made again, so that they hear what happened
            _ = PodcastStore.shared
        }
    }
}
