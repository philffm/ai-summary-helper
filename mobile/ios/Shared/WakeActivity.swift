#if canImport(AlarmKit)
import AlarmKit

/// What the alarm's Live Activity is about (the countdown after "Snooze").
@available(iOS 26.0, *)
struct WakeMetadata: AlarmMetadata {}
#endif
