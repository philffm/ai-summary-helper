import SwiftUI

/// The "Aa" button of a reader. Its sheet leaves the article visible and usable, so that every choice shows at once;
/// on a wide window it is a popover beside the button.
struct ReaderDisplayButton: View {
    @State private var shown = false
    private static let height: CGFloat = 500

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
    let close: () -> Void
    private var stored = StoredReaderLook()

    init(close: @escaping () -> Void) { self.close = close }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("Appearance").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Reset") { stored.reset() }
                    .font(.body.weight(.semibold))
                    .disabled(stored.look == ReaderLook())
                Button(action: close) {
                    Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        .background(Color(.tertiarySystemFill), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    heading("Text size")
                    TextSizeRuler(step: stored.$step).padding(.horizontal, 20)
                    heading("Font")
                    faces
                    heading("Line spacing")
                    Picker("Line spacing", selection: stored.$spacing) {
                        ForEach(ReaderLook.Spacing.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 20)
                    heading("Background")
                    grounds
                }
                .padding(.bottom, 20)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
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
                        VStack(alignment: .leading, spacing: 8) {
                            Text(verbatim: "Aa").font(face.sample(30)).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: face.name).font(.footnote.weight(.bold))
                                Text(face.kind).font(.caption).foregroundStyle(.secondary)
                            }
                            .lineLimit(1)
                        }
                        .padding(12)
                        .frame(minWidth: 112, alignment: .leading)
                        .background(on ? Color(.tertiarySystemFill) : .clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
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
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(ground.page ?? Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
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
        VStack(spacing: 6) {
            Text(verbatim: ReaderLook.label(of: step)).font(.subheadline.weight(.bold)).monospacedDigit()
            ZStack(alignment: .bottom) {
                Ticks(position: CGFloat(step), inside: true, spacing: Self.spacing).fill(Color.secondary)
                Ticks(position: CGFloat(step), inside: false, spacing: Self.spacing).fill(Color.secondary.opacity(0.35))
                Capsule().fill(KaivoTokens.accent).frame(width: 3, height: 30)
            }
            .frame(height: 32)
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
                let height: CGFloat = inside && mark % 5 == 0 ? 20 : 10
                path.addRect(CGRect(x: x - 0.75, y: rect.maxY - 4 - height, width: 1.5, height: height))
            }
            return path
        }
    }
}
