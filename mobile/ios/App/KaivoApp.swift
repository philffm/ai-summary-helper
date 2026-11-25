import SwiftUI

@main
struct KaivoApp: App {
    var body: some Scene {
        WindowGroup {
            RootView().tint(KaivoTokens.accent)
        }
    }
}
