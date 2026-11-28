import SwiftUI

@main
struct KaivoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

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
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) { await BackgroundRefresh.run() }
    }
}
