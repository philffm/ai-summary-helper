import Observation
import SafariServices

/// Whether the Safari extension is switched on. iOS 26.2 and later can tell; older versions stay `unknown`.
@MainActor
@Observable
final class ExtensionStatus {
    enum State { case unknown, on, off }
    private(set) var state: State = .unknown

    private static let identifier = Bundle.main.object(forInfoDictionaryKey: "KaivoExtensionBundleId") as? String ?? ""

    func refresh() {
        guard #available(iOS 26.2, *) else { return }
        SFSafariExtensionManager.getStateOfExtension(withIdentifier: Self.identifier) { state, _ in
            let value: State = state.map { $0.isEnabled ? .on : .off } ?? .unknown
            Task { @MainActor in self.state = value }
        }
    }

    @available(iOS 26.2, *)
    func openSettings() {
        SFSafariSettings.openExtensionsSettings(forIdentifiers: [Self.identifier]) { _ in }
    }
}
