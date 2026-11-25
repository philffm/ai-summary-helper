#if DEBUG
import SwiftUI
import WidgetKit

/// Debug only (`-KaivoStartTab widgets`): the widgets' views at their home and lock screen sizes, with the sample data.
struct WidgetGallery: View {
    @Environment(Library.self) private var library
    @Environment(FeedsModel.self) private var feeds

    var body: some View {
        let snapshot = Snapshot.make(library: library, feeds: feeds)
        ScrollView {
            VStack(spacing: 16) {
                tile(338, 158) { BriefingWidgetView(snapshot: snapshot, family: .systemMedium) }
                HStack(spacing: 22) {
                    tile(158, 158) { BriefingWidgetView(snapshot: snapshot, family: .systemSmall) }
                    tile(158, 158, background: KaivoTokens.savedNoteUserBg) { QuoteWidgetView(snapshot: snapshot) }
                }
                HStack(spacing: 22) {
                    tile(158, 158) { ReadingWidgetView(snapshot: snapshot) }
                    tile(158, 158) { ReadingWidgetView(snapshot: Snapshot()) }
                }
                BriefingWidgetView(snapshot: snapshot, family: .accessoryRectangular)
                    .frame(width: 172, height: 76)
                    .padding(8)
                    .background(Color.black, in: RoundedRectangle(cornerRadius: 14))
                    .environment(\.colorScheme, .dark)
            }
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func tile(_ width: CGFloat, _ height: CGFloat, background: Color = Color(.systemBackground), @ViewBuilder _ content: () -> some View) -> some View {
        content()
            .padding(16)
            .frame(width: width, height: height)
            .background(background, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
#endif
