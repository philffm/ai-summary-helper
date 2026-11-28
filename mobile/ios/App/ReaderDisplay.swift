import SwiftUI

/// The "Aa" button of a reader. Its sheet leaves the article visible and usable, so that every choice shows at once;
/// on a wide window it is a popover beside the button.
struct ReaderDisplayButton: View {
    @State private var shown = false
    private static let height: CGFloat = 420

    var body: some View {
        Button { shown.toggle() } label: { Label("Appearance", systemImage: "textformat.size") }
            .popover(isPresented: $shown) {
                ReaderDisplayPanel { shown = false }
                    .frame(minWidth: 360, idealWidth: 380, minHeight: 320, idealHeight: Self.height)
                    .presentationDetents([.height(Self.height), .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .height(Self.height)))
                    .presentationDragIndicator(.hidden)
                    // solid: the article behind it would show through the choices
                    .presentationBackground(Color(.secondarySystemBackground))
            }
    }
}

struct ReaderDisplayPanel: View {
    /// nil inside the reader's menu, which has its own head and is closed by its own means.
    let close: (() -> Void)?
    private var stored = StoredReaderLook()

    init(close: (() -> Void)? = nil) { self.close = close }

    var body: some View {
        VStack(spacing: 0) {
            if let close {
                HStack(spacing: 12) {
                    Text("Appearance").font(.headline).accessibilityAddTraits(.isHeader)
                    Spacer()
                    reset
                    Button(action: close) {
                        Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                            .background(Color(.tertiarySystemFill), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 4)
            }
            // everything in view at half height on a small phone
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    group {
                        HStack {
                            heading("Text size")
                            Spacer()
                            // the menu has no head of its own for it
                            if close == nil { reset.padding(.trailing, 20) }
                        }
                        TextSizeRuler(step: stored.$step).padding(.horizontal, 20)
                    }
                    group {
                        heading("Font")
                        faces
                    }
                    group {
                        heading("Line spacing")
                        Picker("Line spacing", selection: stored.$spacing) {
                            ForEach(ReaderLook.Spacing.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 20)
                    }
                    group {
                        heading("Background")
                        grounds
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 8)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private var reset: some View {
        Button("Reset") { stored.reset() }
            .font(.subheadline.weight(.semibold))
            .disabled(stored.look == ReaderLook())
    }

    private func group(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6, content: content)
    }

    private func heading(_ title: LocalizedStringKey) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).padding(.horizontal, 20).accessibilityAddTraits(.isHeader)
    }

    private var faces: some View {
        ScrollViewReader { proxy in
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(ReaderLook.Face.allCases) { face in
                    let on = stored.face == face
                    Button { stored.face = face } label: {
                        HStack(spacing: 8) {
                            Text(verbatim: "Aa").font(face.sample(21)).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(verbatim: face.name).font(.footnote.weight(.bold))
                                Text(face.kind).font(.caption2).foregroundStyle(.secondary)
                            }
                            .lineLimit(1)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(on ? Color(.tertiarySystemFill) : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(on ? KaivoTokens.accent : Color(.separator), lineWidth: on ? 2 : 1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("face-" + face.rawValue)
                    .id(face)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
        // the chosen face is in view when the sheet opens
        .onAppear { proxy.scrollTo(stored.face) }
        }
    }

    private var grounds: some View {
        HStack(spacing: 8) {
            ForEach(ReaderLook.Ground.allCases) { ground in
                let on = stored.ground == ground
                Button { stored.ground = ground } label: {
                    Text(ground.title).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                        .foregroundStyle(Color(uiColor: ground.ink))
                        .padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(ground.page ?? Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(on ? KaivoTokens.accent : Color(.separator), lineWidth: on ? 2 : 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("ground-" + ground.rawValue)
            }
        }
        .padding(.horizontal, 20)
    }
}

/// The text size as a ruler that moves under a fixed mark: dragged to the left, the text grows.
struct TextSizeRuler: View {
    @Binding var step: Int
    @State private var from: Int?
    private static let spacing: CGFloat = 40

    var body: some View {
        VStack(spacing: 0) {
            Text(verbatim: ReaderLook.label(of: step)).font(.caption.weight(.bold)).monospacedDigit()
            ZStack(alignment: .bottom) {
                Ticks(position: CGFloat(step), inside: true, spacing: Self.spacing).fill(Color.secondary)
                Ticks(position: CGFloat(step), inside: false, spacing: Self.spacing).fill(Color.secondary.opacity(0.35))
                Capsule().fill(KaivoTokens.accent).frame(width: 3, height: 22)
            }
            .frame(height: 24)
            .mask {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.22),
                                       .init(color: .black, location: 0.78), .init(color: .clear, location: 1)],
                               startPoint: .leading, endPoint: .trailing)
            }
            .animation(.snappy(duration: 0.16), value: step)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { drag in
                    let start = from ?? step
                    from = start
                    step = clamped(start - Int((drag.translation.width / Self.spacing).rounded()))
                }
                .onEnded { _ in from = nil }
        )
        // a scale of numbers, read from left to right in every language
        .environment(\.layoutDirection, .leftToRight)
        .sensoryFeedback(.selection, trigger: step)
        .accessibilityElement()
        .accessibilityLabel("Text size")
        .accessibilityValue(Text(verbatim: ReaderLook.label(of: step)))
        .accessibilityIdentifier("textSizeRuler")
        .accessibilityAdjustableAction { direction in
            if direction == .increment { step = clamped(step + 1) } else if direction == .decrement { step = clamped(step - 1) }
        }
    }

    private func clamped(_ value: Int) -> Int { min(max(value, ReaderLook.steps.lowerBound), ReaderLook.steps.upperBound) }

    private struct Ticks: Shape {
        var position: CGFloat
        /// The marks within the range of steps, or those beyond its ends.
        let inside: Bool
        let spacing: CGFloat

        var animatableData: CGFloat {
            get { position }
            set { position = newValue }
        }

        func path(in rect: CGRect) -> Path {
            var path = Path()
            let first = ReaderLook.steps.lowerBound, span = ReaderLook.steps.count - 1
            // five marks to a step, and some beyond both ends so that the ruler never stops short
            for mark in -40...(span * 5 + 40) where (0...span * 5).contains(mark) == inside {
                let x = rect.midX + (CGFloat(first) + CGFloat(mark) / 5 - position) * spacing
                guard x >= rect.minX, x <= rect.maxX else { continue }
                let height: CGFloat = inside && mark % 5 == 0 ? 14 : 7
                path.addRect(CGRect(x: x - 0.75, y: rect.maxY - 4 - height, width: 1.5, height: height))
            }
            return path
        }
    }
}
