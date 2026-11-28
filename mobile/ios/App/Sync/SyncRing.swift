import SwiftUI

extension SyncModel {
    /// A run is going on, the first one of a new library included.
    var running: Bool { joining || fetching }
    /// How far it is, from 0 to 1; nil while that is not known yet.
    var fraction: Double? {
        guard running, let progress, progress.total > 0 else { return nil }
        return min(1, Double(progress.done) / Double(progress.total))
    }
    /// The last run did not end well.
    var failed: Bool { !running && (problem != nil || state?.last?.ok == false) }
}

/// The library's place in the bars of the tabs, there once a library is joined: how far it is while it is fetched, a
/// warning when that failed. A tap opens "Sync".
struct SyncToolbar: ToolbarContent {
    let sync: SyncModel

    var body: some ToolbarContent {
        if sync.state != nil || sync.joining {
            ToolbarItem(placement: .topBarTrailing) { SyncButton() }
            if #available(iOS 26.0, *) { ToolbarSpacer(.fixed, placement: .topBarTrailing) }
        }
    }
}

private struct SyncButton: View {
    @Environment(SyncModel.self) private var sync

    var body: some View {
        Button { sync.shown = true } label: { SyncGlyph() }
            .accessibilityLabel("Sync")
            .accessibilityValue(value)
            .accessibilityIdentifier("sync-button")
    }

    private var value: Text {
        if let progress = sync.progress, sync.running, progress.total > 0 {
            Text("\(String(progress.done)) of \(String(progress.total)) entries")
        } else if sync.running {
            Text("Syncing")
        } else if sync.failed {
            Text("Last sync failed")
        } else {
            Text(verbatim: "")
        }
    }
}

/// The small picture of the sync's state, for a bar or a row.
struct SyncGlyph: View {
    @Environment(SyncModel.self) private var sync

    var body: some View {
        Group {
            if let fraction = sync.fraction {
                Gauge(value: fraction) {
                    EmptyView()
                } currentValueLabel: {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 22, weight: .semibold))
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(KaivoTokens.accent)
                .scaleEffect(0.48)
            } else if sync.running {
                ProgressView()
            } else if sync.failed {
                Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
            } else {
                Image(systemName: "arrow.triangle.2.circlepath")
            }
        }
        .frame(width: 28, height: 28)
    }
}

/// The large ring of the "Sync" screen.
struct SyncRing: View {
    @Environment(SyncModel.self) private var sync
    private static let size: CGFloat = 164

    var body: some View {
        ZStack {
            if sync.running && sync.fraction == nil {
                ProgressView().controlSize(.large)
            } else {
                // the system's gauge, drawn large
                Gauge(value: sync.fraction ?? (sync.failed ? 0 : 1)) { EmptyView() }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(sync.failed ? Color.red : KaivoTokens.accent)
                    .scaleEffect(Self.size / 58)
                    .accessibilityHidden(true)
                if let progress = sync.progress, sync.running {
                    VStack(spacing: 0) {
                        Text(verbatim: progress.done.formatted()).font(.largeTitle.weight(.bold)).monospacedDigit()
                        Text("of \(progress.total.formatted())").font(.subheadline).foregroundStyle(.secondary)
                    }
                } else {
                    Image(systemName: sync.failed ? "exclamationmark" : "checkmark")
                        .font(.system(size: 52, weight: .bold))
                        .foregroundStyle(sync.failed ? Color.red : KaivoTokens.accent)
                        .accessibilityHidden(true)
                }
            }
        }
        .frame(width: Self.size, height: Self.size)
        .accessibilityElement(children: .combine)
    }
}
