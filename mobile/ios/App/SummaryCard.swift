import SwiftUI

/// The summary at the top of an article, set apart from the article's own words: folded to one row until asked for.
/// Where there is none yet it offers to write one, and shows how far that is.
struct SummaryCard: View {
    let article: Article
    @Binding var open: Bool
    /// A summary is being written; `step` says which part of how many.
    let waiting: Bool
    let step: (at: Int, of: Int)
    /// A model is set up, so one can be written again.
    let again: Bool
    let summarize: () -> Void

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(KaivoTokens.accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .tint(KaivoTokens.accent)
    }

    @ViewBuilder
    private var content: some View {
        if !article.summary.isEmpty {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(blocks) { row($0) }
                    if waiting {
                        progress
                    } else if again {
                        Button("Summarize again", action: summarize).frame(minHeight: 44)
                    }
                    SampleNote()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
                .padding(.bottom, 4)
            } label: {
                // the group's own head opens and closes it
                Label("Summary", systemImage: "sparkles")
                    .font(.headline)
                    .frame(minHeight: 44)
                    .foregroundStyle(KaivoTokens.accent)
                    .accessibilityIdentifier("summary-card")
            }
        } else if waiting {
            progress.padding(.vertical, 8)
        } else {
            Button(action: summarize) {
                Label("Summarize", systemImage: "sparkles")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(KaivoTokens.accent)
        }
    }

    private var blocks: [SummaryText.Block] {
        article.summaryHTML.map { SummaryText.blocks(html: $0) } ?? SummaryText.blocks(lines: article.summary)
    }

    @ViewBuilder
    private func row(_ block: SummaryText.Block) -> some View {
        switch block.kind {
        case .heading:
            Text(block.text).font(.headline).accessibilityAddTraits(.isHeader)
        case .paragraph:
            Text(block.text).font(.callout)
        case .item(let number):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: number.map { "\($0)." } ?? "•").foregroundStyle(.secondary).accessibilityHidden(number == nil)
                Text(block.text)
            }
            .font(.callout)
        }
    }

    private var progress: some View {
        HStack(spacing: 12) {
            if step.of > 1 {
                Gauge(value: Double(max(0, step.at - 1)), in: 0...Double(step.of)) { EmptyView() }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(KaivoTokens.accent)
                    .scaleEffect(0.5)
                    .frame(width: 30, height: 30)
            } else {
                ProgressView()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Summarizing").font(.headline).foregroundStyle(KaivoTokens.accent)
                if step.of > 1 { Text("Part \(step.at) of \(step.of)").font(.footnote).foregroundStyle(.secondary) }
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
