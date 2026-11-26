import SwiftUI
import UniformTypeIdentifiers

/// The alarm's settings, shown as a sheet from Today (iOS 26 and later).
@available(iOS 26.0, *)
struct WakeView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var settings = WakeSettings.load()
    @State private var problem: LocalizedStringKey?
    @State private var ringing = false
    @State private var importing = false

    private var time: Binding<Date> {
        Binding {
            Calendar.current.date(bySettingHour: settings.hour, minute: settings.minute, second: 0, of: .now) ?? .now
        } set: { date in
            settings.hour = Calendar.current.component(.hour, from: date)
            settings.minute = Calendar.current.component(.minute, from: date)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Wake alarm", isOn: $settings.enabled)
                    DatePicker("Time", selection: time, displayedComponents: .hourAndMinute)
                    days
                } footer: {
                    if let problem {
                        Text(problem).foregroundStyle(KaivoTokens.dangerText)
                    } else {
                        Text("Rings even when the phone is silent or in a Focus.")
                    }
                }
                if WakeAlarm.denied {
                    Button("Allow alarms in Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                }
                Section("Wake me with") {
                    Picker("Wake me with", selection: $settings.mode) {
                        row("Daily briefing", "New stories from your feeds").tag(WakeMode.briefing)
                        row("A random article", "Unread, from your library").tag(WakeMode.article)
                        row("Remember?", "One of your highlights with a word missing").tag(WakeMode.remember)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    if settings.mode == .briefing { Toggle("Leave out bad news", isOn: $settings.noBadNews) }
                }
                Section {
                    Picker("Second button", selection: $settings.button) {
                        Text("Play").tag(WakeSettings.Button.play)
                        Text("Snooze").tag(WakeSettings.Button.snooze)
                    }
                    if settings.button == .snooze {
                        Stepper(value: $settings.snoozeMinutes, in: 1...30) { Text("Snooze for \(String(settings.snoozeMinutes)) min") }
                    }
                    Picker("Sound", selection: $settings.sound) {
                        Text("System sound").tag("")
                        Text("Well").tag(WakeSound.well)
                        if FileManager.default.fileExists(atPath: WakeSound.ownFile.path) { Text("Own file").tag(WakeSound.own) }
                    }
                    Button("Choose an audio file…") { importing = true }
                } footer: {
                    Text("The alarm shows Stop and one more button: Play opens Kaivo and reads to you, Snooze rings again later.")
                }
                Section {
                    Button("Preview") { dismiss(); WakeCenter.shared.playing = WakeRequest(mode: settings.mode, noBadNews: settings.noBadNews) }
                    Button("Ring in 10 seconds") { ring() }
                } footer: {
                    if ringing { Text("Lock the phone now to see it as in the morning.") }
                }
            }
            .navigationTitle("Wake")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .onChange(of: settings) { old, new in
                new.save()
                if old.enabled || new.enabled { apply(new) }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
                guard case .success(let url) = result else { return }
                do {
                    try WakeSound.takeOver(url)
                    let again = settings.sound == WakeSound.own
                    settings.sound = WakeSound.own
                    if again && settings.enabled { apply(settings) }
                } catch { problem = "This file cannot be used." }
            }
        }
    }

    private var days: some View {
        // Monday first, in the order the settings count
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        let names = Calendar.current.standaloneWeekdaySymbols
        return HStack {
            ForEach(1...7, id: \.self) { day in
                let on = settings.days.contains(day)
                Button {
                    if on { settings.days.remove(day) } else { settings.days.insert(day) }
                } label: {
                    Text(verbatim: symbols[day % 7]).font(.subheadline.weight(.bold)).frame(maxWidth: .infinity, minHeight: 38)
                        .background(on ? KaivoTokens.accent : Color(.tertiarySystemFill), in: Circle())
                        .foregroundStyle(on ? Color(.systemBackground) : Color.primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: names[day % 7]))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    private func row(_ title: LocalizedStringKey, _ text: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(text).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func apply(_ value: WakeSettings) {
        Task {
            do {
                try await WakeAlarm.apply(value)
                problem = nil
            } catch WakeAlarm.Failure.noDays {
                problem = "Pick at least one day."
            } catch {
                problem = "The alarm could not be set. Check that Kaivo may use alarms."
                settings.enabled = false
            }
        }
    }

    private func ring() {
        Task {
            do {
                try await WakeAlarm.test(settings)
                ringing = true
            } catch {
                problem = "The alarm could not be set. Check that Kaivo may use alarms."
            }
        }
    }
}
