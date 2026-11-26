import SwiftUI

@main
struct KaivoApp: App {
    init() {
        #if DEBUG
        if LaunchOptions.seed { SampleData.seed() }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView().tint(KaivoTokens.accent)
        }
    }
}
