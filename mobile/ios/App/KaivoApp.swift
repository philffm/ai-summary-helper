import SwiftUI

@main
struct KaivoApp: App {
    init() {
        ReaderLook.migrate()
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
