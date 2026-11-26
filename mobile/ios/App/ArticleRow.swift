import SwiftUI

struct ArticleRow: View {
    let article: Article

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(article.title).font(.body.weight(.medium)).fontDesign(.serif)
            Text(verbatim: "\(article.host) · \(article.duration) · \(article.age)").font(.footnote).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Says that what is on screen is made up (debug builds only; release builds have no samples).
struct SampleNote: View {
    var body: some View {
        #if DEBUG
        if LaunchOptions.samples && !LaunchOptions.screenshots { Text("Sample data").font(.footnote).foregroundStyle(.secondary) }
        #endif
    }
}
