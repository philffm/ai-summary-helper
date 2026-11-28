import SwiftUI

/// The first start, for someone who knows nothing of Kaivo yet: what it does, how to switch it on in Safari, and how a
/// page gets in. Shown once, and again from "Settings".
struct WelcomeView: View {
    static let seenKey = "welcomeSeen"

    /// At the first start, with nothing saved yet. A debug start with options (screenshots, tests) goes straight in,
    /// unless it asks for this screen.
    static func isDue(empty: Bool, seen: Bool, arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        #if DEBUG
        if arguments.contains("-KaivoWelcome") { return true }
        if arguments.contains(where: { $0.hasPrefix("-Kaivo") }) { return false }
        #endif
        return empty && !seen
    }

    enum Step: Int, CaseIterable { case hello, safari, save, done }

    @Environment(\.dismiss) private var dismiss
    @Environment(ExtensionStatus.self) private var status
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var step = Step.hello

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch step {
                    case .hello: hello
                    case .safari: safari
                    case .save: save
                    case .done: done
                    }
                    // at very large sizes a bar that stays would cover most of the page: the buttons end the text then
                    if textSize.isAccessibilitySize { buttons }
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            // each step starts at its top
            .id(step)
            .safeAreaInset(edge: .bottom) {
                if !textSize.isAccessibilitySize {
                    buttons.padding(.horizontal, 24).padding(.vertical, 8).background(.bar)
                }
            }
            .toolbar {
                if step != .hello {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { step = Step(rawValue: step.rawValue - 1) ?? .hello } label: { Label("Back", systemImage: "chevron.left") }
                    }
                }
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 6) {
                        ForEach(Step.allCases, id: \.self) { one in
                            Capsule().fill(one == step ? KaivoTokens.accent : Color(.systemGray4)).frame(width: one == step ? 22 : 8, height: 8)
                        }
                    }
                    .accessibilityElement()
                    .accessibilityLabel("Step \(step.rawValue + 1) of \(Step.allCases.count)")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .tint(KaivoTokens.accent)
        }
        .onAppear { status.refresh() }
    }

    private var buttons: some View {
        VStack(spacing: 6) {
            Button { next() } label: {
                Group {
                    switch step {
                    case .hello: Text("Show me how")
                    case .done: Text("Start reading")
                    default: Text("Next")
                    }
                }
                .font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .accessibilityIdentifier("welcome-next")
            if step != .done {
                Button("Skip") { dismiss() }.frame(minHeight: 44).accessibilityIdentifier("welcome-skip")
            }
        }
    }

    private func next() {
        guard let after = Step(rawValue: step.rawValue + 1) else { return dismiss() }
        step = after
    }

    private func title(_ text: LocalizedStringKey, _ below: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).font(.largeTitle.weight(.bold)).fontDesign(.serif).accessibilityAddTraits(.isHeader)
            Text(below).font(.body).foregroundStyle(.secondary)
        }
    }

    private func row(_ symbol: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Image(systemName: symbol).font(.title3).foregroundStyle(KaivoTokens.accent).frame(width: 30).accessibilityHidden(true)
            Text(text)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var hello: some View {
        Image("Logo").resizable().frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous)).accessibilityHidden(true)
        title("Welcome to Kaivo", "Save what you want to read. Read it in peace, whenever you like.")
        row("bookmark", "Save articles from Safari or any app.")
        row("text.alignleft", "Get a short version and ask questions, with the AI model you choose.")
        row("highlighter", "Mark what matters and find it again.")
    }

    @ViewBuilder private var safari: some View {
        title("Switch on Kaivo in Safari", "Kaivo adds a button to Safari. You switch it on once.")
        if status.state == .on {
            row("checkmark.circle.fill", "Kaivo is on in Safari")
        } else {
            row("1.circle", "Open Settings → Apps → Safari → Extensions.")
            row("2.circle", "Turn on Kaivo.")
            row("3.circle", "Under “Permissions”, allow it on all websites.")
            if #available(iOS 26.2, *) {
                Button("Open extension settings") { status.openSettings() }.buttonStyle(.bordered).controlSize(.large)
            }
        }
    }

    @ViewBuilder private var save: some View {
        title("Save your first page", "Two ways, both work.")
        Text("In Safari").font(.headline).accessibilityAddTraits(.isHeader)
        row("safari", "Open an article, tap the page menu in the address bar and choose Kaivo.")
        Text("From any app").font(.headline).accessibilityAddTraits(.isHeader)
        row("square.and.arrow.up", "Tap Share and choose Kaivo. The text is fetched when you open Kaivo.")
    }

    @ViewBuilder private var done: some View {
        title("You’re set", "Everything stays on this device. These are optional, under “Settings”:")
        row("arrow.triangle.2.circlepath", "Connect the library you keep on your computer.")
        row("cpu", "Choose the model that writes summaries.")
    }
}
