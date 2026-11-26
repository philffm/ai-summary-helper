import SwiftUI

/// The one control the system does not have: topics as a cluster of bubbles, larger and deeper in colour for the more
/// used ones. Tapping one filters the list and leads on to the topic net.
struct TopicBubbles: View {
    struct Topic: Identifiable, Equatable {
        var name: String
        var count: Int
        var id: String { name }
    }

    let topics: [Topic]
    let pick: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let most = Double(topics.map(\.count).max() ?? 1)
        // area follows how often a topic is used; a small taper keeps equally used topics from looking like a row of coins
        let radii = topics.enumerated().map { index, topic in
            CGFloat(max(0.5, (Double(topic.count) / most).squareRoot() - 0.07 * Double(index)))
        }
        BubbleLayout(radii: radii) {
            ForEach(Array(topics.enumerated()), id: \.element.id) { rank, topic in
                bubble(topic, rank: rank)
                    .scaleEffect(shown || reduceMotion ? 1 : 0.3)
                    .opacity(shown || reduceMotion ? 1 : 0)
                    .animation(reduceMotion ? nil : .spring(duration: 0.55, bounce: 0.35).delay(Double(rank) * 0.05), value: shown)
            }
        }
        .onAppear { shown = true }
    }

    private func bubble(_ topic: Topic, rank: Int) -> some View {
        let strong = rank == 0
        let depth = [1.0, 0.55, 0.34, 0.24, 0.18, 0.14][min(rank, 5)]
        return Button { pick(topic.name) } label: {
            Text(verbatim: topic.name)
                .font(rank == 0 ? .headline : .footnote.weight(.semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .padding(6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(strong ? Color(.systemBackground) : Color.primary)
                .background(Circle().fill(KaivoTokens.accent.opacity(strong ? 1 : depth)))
                .contentShape(Circle())
        }
        .buttonStyle(PressedBubble(reduceMotion: reduceMotion))
        .accessibilityLabel("Topic \(topic.name)")
        .accessibilityValue(Text(verbatim: topic.count.formatted()))
    }
}

struct PressedBubble: ButtonStyle {
    let reduceMotion: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.92 : 1)
            .animation(.snappy(duration: 0.2), value: configuration.isPressed)
    }
}

private struct BubbleLayout: Layout {
    let radii: [CGFloat]
    private let maxHeight: CGFloat = 220

    private func arrangement(width: CGFloat) -> (centers: [CGPoint], scale: CGFloat, size: CGSize) {
        let centers = CirclePacking.centers(radii: radii, gap: 0.05)
        let box = CirclePacking.bounds(centers: centers, radii: radii)
        guard box.width > 0, box.height > 0 else { return (centers, 0, CGSize(width: width, height: 0)) }
        // room for the selection ring around the outer bubbles
        let scale = min((width - 12) / box.width, (maxHeight - 12) / box.height)
        let size = CGSize(width: width, height: box.height * scale + 12)
        let left = (width - box.width * scale) / 2
        return (centers.map { CGPoint(x: left + ($0.x - box.minX) * scale, y: 6 + ($0.y - box.minY) * scale) }, scale, size)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width ?? 340).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let a = arrangement(width: bounds.width)
        for (index, view) in subviews.enumerated() where index < radii.count {
            let diameter = radii[index] * 2 * a.scale
            view.place(at: CGPoint(x: bounds.minX + a.centers[index].x, y: bounds.minY + a.centers[index].y), anchor: .center,
                       proposal: ProposedViewSize(width: diameter, height: diameter))
        }
    }
}

/// Places circles close together without overlap, wider than tall. The same input always gives the same picture.
enum CirclePacking {
    static func centers(radii: [CGFloat], gap: CGFloat) -> [CGPoint] {
        var placed: [CGPoint] = []
        for (index, radius) in radii.enumerated() {
            if placed.isEmpty { placed.append(.zero); continue }
            var best: (point: CGPoint, cost: CGFloat)?
            // candidates: touching one of the circles already there, all the way round
            for other in 0..<index {
                let distance = radii[other] + radius + gap
                for step in 0..<72 {
                    let angle = CGFloat(step) * .pi / 36
                    let p = CGPoint(x: placed[other].x + cos(angle) * distance, y: placed[other].y + sin(angle) * distance)
                    let free = (0..<index).allSatisfy { hypot(p.x - placed[$0].x, p.y - placed[$0].y) >= radii[$0] + radius + gap - 0.0001 }
                    // height costs more than width, so the cluster spreads sideways
                    let cost = hypot(p.x, p.y * 2.2)
                    if free && cost < (best?.cost ?? .infinity) { best = (p, cost) }
                }
            }
            placed.append(best?.point ?? CGPoint(x: (placed.map(\.x).max() ?? 0) + 2 + gap, y: 0))
        }
        return placed
    }

    static func bounds(centers: [CGPoint], radii: [CGFloat]) -> CGRect {
        zip(centers, radii).reduce(CGRect.null) { box, circle in
            box.union(CGRect(x: circle.0.x - circle.1, y: circle.0.y - circle.1, width: circle.1 * 2, height: circle.1 * 2))
        }
    }
}
