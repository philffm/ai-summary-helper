import SwiftUI

// Layouts by the room there is, never by the device: a phone's inner display, a tablet or a wide window get two columns,
// and on a folding device the system keeps them off the fold (ArrangementView, iOS 27.1).

/// The screen a route leads to.
struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .article(let id): ReaderView(id: id)
        case .item(let feed, let id): FeedItemView(feedURL: feed, itemID: id)
        }
    }
}

/// A list and what is chosen in it. Narrow: one column, the choice slides over the list. Wide: side by side. The system
/// switches between the two, so the open article stays open when the device is folded or unfolded.
struct ListAndDetail<Sidebar: View>: View {
    @Binding var path: [Route]
    let empty: LocalizedStringKey
    let symbol: String
    @ViewBuilder let list: (Binding<Route?>) -> Sidebar

    var body: some View {
        NavigationSplitView {
            list(Binding(get: { path.first }, set: { path = $0.map { [$0] } ?? [] }))
                .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 440)
        } detail: {
            NavigationStack {
                if let route = path.first {
                    RouteView(route: route).id(route)
                } else {
                    ContentUnavailableView(empty, systemImage: symbol)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

extension View {
    /// Reading hides the tabs only where the article covers the whole screen. Beside a list they stay: they are the way out.
    func readingFullScreen() -> some View { modifier(ReadingFullScreen()) }
}

private struct ReadingFullScreen: ViewModifier {
    @Environment(\.tabsStay) private var tabsStay

    func body(content: Content) -> some View {
        content.toolbar(tabsStay ? .automatic : .hidden, for: .tabBar)
    }
}

private struct TabsStayKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// Set on a wide window. (The detail column of a split view reports its own, narrow, size class.)
    var tabsStay: Bool {
        get { self[TabsStayKey.self] }
        set { self[TabsStayKey.self] = newValue }
    }
}

/// The room between a part and the middle of a two-part screen: the same as between a part and the outer edge, so that
/// nothing lies on the fold. (Half open, `ArrangementView` moves the parts clear of it itself.)
enum Gutter { static let half: CGFloat = 20 }

/// Two parts beside each other where the window is wide, in the order given where it is not.
struct TwoParts<First: View, Second: View>: View {
    @ViewBuilder let first: () -> First
    @ViewBuilder let second: () -> Second

    var body: some View {
        if #available(iOS 27.1, *) {
            ArrangementView(primary: first, secondary: second).arrangementViewStyle(.split)
        } else {
            HStack(spacing: 0) {
                first()
                second()
            }
        }
    }
}
