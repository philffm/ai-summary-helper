import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

/// The countdown after "Snooze", on the lock screen and in the Dynamic Island.
@available(iOS 26.0, *)
struct WakeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<WakeMetadata>.self) { context in
            HStack {
                Label("Snoozing", systemImage: "zzz").font(.headline)
                Spacer()
                remaining(context.state).font(.title.monospacedDigit())
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Label("Snoozing", systemImage: "zzz") }
                DynamicIslandExpandedRegion(.trailing) { remaining(context.state).monospacedDigit() }
            } compactLeading: {
                Image(systemName: "alarm")
            } compactTrailing: {
                remaining(context.state).monospacedDigit().frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "alarm")
            }
        }
    }

    @ViewBuilder
    private func remaining(_ state: AlarmPresentationState) -> some View {
        if case .countdown(let countdown) = state.mode {
            Text(timerInterval: Date.now...max(Date.now, countdown.fireDate), countsDown: true)
        }
    }
}
