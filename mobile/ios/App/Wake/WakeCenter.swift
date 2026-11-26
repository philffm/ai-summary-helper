import Foundation
import Observation

/// Asks for the wake screen: from the alarm's "Play" button, or as a preview.
@MainActor
@Observable
final class WakeCenter {
    static let shared = WakeCenter()
    var playing: WakeRequest?
}

struct WakeRequest: Identifiable, Equatable {
    let id = UUID()
    var mode: WakeMode
    var noBadNews: Bool
}
