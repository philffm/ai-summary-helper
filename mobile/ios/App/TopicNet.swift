import SwiftUI

/// Where the circles of the topic net lie. Pure, so that the lines and the bubbles share it and it can be tested.
enum NetLayout {
    static let height: CGFloat = 220
    static let centre: CGFloat = 46
    static let satellite: ClosedRange<CGFloat> = 26...34
    static let most = 6

    /// The chosen topics as they are named together: always in the same order, since the articles are the same whichever
    /// was chosen first.
    static func together(_ topics: [String]) -> [String] { topics.sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    /// In degrees, clockwise from the right; the most shared topic first. Straight above and below the middle stays free.
    private static let places: [Double] = [180, 0, 240, 60, 300, 120]

    /// The middle and the places around it, moved up or down so that the whole net sits in the middle of its room.
    static func positions(_ count: Int, width: CGFloat) -> (middle: CGPoint, around: [CGPoint]) {
        let rx = min(150, width / 2 - satellite.upperBound - 4), ry = height / 2 - satellite.upperBound - 2
        let offsets = places.prefix(count).map { degrees in
            let angle = degrees * .pi / 180
            return CGPoint(x: cos(angle) * rx, y: sin(angle) * ry)
        }
        let top = offsets.map { $0.y - satellite.upperBound }.reduce(-centre, min)
        let bottom = offsets.map { $0.y + satellite.upperBound }.reduce(centre, max)
        let middle = CGPoint(x: width / 2, y: (height - top - bottom) / 2)
        return (middle, offsets.map { CGPoint(x: middle.x + $0.x, y: middle.y + $0.y) })
    }

    static let outer: CGFloat = 22
    static let outerMost = 4

    /// Places for the second ring, in the corners of the net's room: for each circle it is reached through (an index into
    /// `around`), the free corner nearest to it. nil where no corner is left clear of the ring.
    static func corners(through bridges: [Int], middle: CGPoint, around: [CGPoint], width: CGFloat) -> [CGPoint?] {
        let reach = min(width / 2 - outer - 2, 150 + satellite.upperBound + 24)
        var free: [CGPoint] = []
        for x in [width / 2 - reach, width / 2 + reach] {
            for y in [outer + 2, height - outer - 2] {
                let corner = CGPoint(x: x, y: y)
                let clearOfRing = around.allSatisfy { distance(corner, $0) >= satellite.upperBound + outer + 2 }
                if clearOfRing && distance(corner, middle) >= centre + outer + 2 { free.append(corner) }
            }
        }
        var places: [CGPoint?] = []
        for index in bridges {
            guard around.indices.contains(index),
                  let best = free.indices.min(by: { distance(free[$0], around[index]) < distance(free[$1], around[index]) }) else {
                places.append(nil)
                continue
            }
            places.append(free.remove(at: best))
        }
        return places
    }

    private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

    /// The area follows how many articles are shared.
    static func radius(_ count: Int, of most: Int) -> CGFloat {
        satellite.lowerBound + (satellite.upperBound - satellite.lowerBound) * CGFloat(Double(count) / Double(max(1, most))).squareRoot()
    }
}

/// A topic that is reached only through one of the connected ones.
struct Beyond: Identifiable, Equatable {
    var topic: TopicBubbles.Topic
    var via: String
    var id: String { topic.name }
}

/// The second step after choosing a topic: it stands in the middle, around it the topics that share articles with it.
/// Tapping one of those narrows the list further, and so does pulling it onto the middle, which shows what is to come
/// before letting go. Tapping the middle goes back a step. Dashed, further out: topics reached only through a connected
/// one; tapping one of those moves on to that pair.
struct TopicNet: View {
    @Binding var chosen: [String]
    /// How many articles carry every chosen topic.
    let articles: Int
    /// The topics those articles also carry, the most shared first.
    let related: [TopicBubbles.Topic]
    /// The second ring.
    let beyond: [Beyond]
    /// The topic held over the middle: the list shows what letting go would leave.
    @Binding var preview: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var held: Held?

    private struct Held: Equatable {
        var name: String
        var offset: CGSize
        var over: Bool
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            trail
            GeometryReader { geometry in
                let shown = Array(related.prefix(NetLayout.most))
                let (middle, places) = NetLayout.positions(shown.count, width: geometry.size.width)
                let most = shown.first?.count ?? 1
                let far = beyond.compactMap { item in shown.firstIndex { $0.name == item.via }.map { (item, $0) } }
                let corners = NetLayout.corners(through: far.map(\.1), middle: middle, around: places, width: geometry.size.width)
                let outer = zip(far, corners).compactMap { pair, corner in corner.map { (item: pair.0, from: places[pair.1], at: $0) } }
                ZStack {
                    ForEach(outer, id: \.item.id) { node in
                        Path { path in path.move(to: node.from); path.addLine(to: node.at) }
                            .stroke(KaivoTokens.accent.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, dash: [4, 5]))
                    }
                    .accessibilityHidden(true)
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, topic in
                        Path { path in path.move(to: middle); path.addLine(to: places[index]) }
                            // thicker the more of the articles the two topics share
                            .stroke(KaivoTokens.accent.opacity(0.35), lineWidth: 1.5 + 5 * Double(topic.count) / Double(max(1, articles)))
                    }
                    .accessibilityHidden(true)
                    ForEach(outer, id: \.item.id) { node in distant(node.item).position(node.at) }
                    centre(covered: held?.over == true).scaleEffect(held?.over == true && !reduceMotion ? 1.14 : 1).position(middle)
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, topic in
                        let radius = NetLayout.radius(topic.count, of: most)
                        let pulled = held?.name == topic.name ? held : nil
                        satellite(topic, radius: radius)
                            .scaleEffect(pulled != nil && !reduceMotion ? 1.08 : 1)
                            .offset(pulled?.offset ?? .zero)
                            .onTapGesture { choose(chosen + [topic.name]) }
                            .modifier(Pull { phase in pull(topic.name, phase, middle: middle, reach: NetLayout.centre + radius * 0.4) })
                            .position(places[index])
                            .zIndex(pulled == nil ? 0 : 1)
                    }
                    if let held, held.over, let topic = shown.first(where: { $0.name == held.name }) {
                        Text("Release to narrow · \(topic.count)")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(.regularMaterial, in: Capsule())
                            .position(x: middle.x, y: NetLayout.height - 14)
                            .zIndex(2)
                    }
                }
                .coordinateSpace(.named("net"))
                // a new choice is a new picture
                .id(chosen)
                .transition(reduceMotion ? .identity : .scale(scale: 0.7).combined(with: .opacity))
            }
            .frame(height: NetLayout.height)
            .sensoryFeedback(.impact, trigger: held?.over == true)
        }
        .onChange(of: held) { _, now in preview = now?.over == true ? now?.name : nil }
        .onDisappear { preview = nil }
    }

    /// A connected topic, pressed and pulled: over the middle the two lie on each other, letting go there narrows.
    private func pull(_ name: String, _ phase: Pull.Phase, middle: CGPoint, reach: CGFloat) {
        func over(_ point: CGPoint) -> Bool { hypot(point.x - middle.x, point.y - middle.y) < reach }
        switch phase {
        case .moved(let offset, let point):
            held = Held(name: name, offset: offset, over: over(point))
        case .ended(let point):
            held = nil
            if over(point) { choose(chosen + [name]) }
        case .cancelled:
            held = nil
        }
    }

    private func distant(_ item: Beyond) -> some View {
        Button { choose([item.via, item.topic.name]) } label: {
            Text(verbatim: item.topic.name).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.6)
                .padding(3)
                .frame(width: NetLayout.outer * 2, height: NetLayout.outer * 2)
                .foregroundStyle(Color.primary)
                .background(Circle().fill(Color(.systemBackground)))
                .overlay(Circle().strokeBorder(KaivoTokens.accent, style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])))
                .contentShape(Circle())
        }
        .buttonStyle(PressedBubble(reduceMotion: reduceMotion))
        .accessibilityLabel("Topic \(item.topic.name)")
        .accessibilityHint("Reached through \(item.via)")
    }

    /// All topics › the chosen ones; each step leads back to itself.
    private var trail: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                Button("All topics") { choose([]) }
                ForEach(Array(chosen.enumerated()), id: \.element) { index, name in
                    Image(systemName: "chevron.forward").font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true)
                    Button { choose(Array(chosen.prefix(index + 1))) } label: { Text(verbatim: name) }
                        .disabled(index == chosen.count - 1)
                }
            }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.borderless)
            .frame(minHeight: 32)
        }
        .scrollIndicators(.hidden)
    }

    /// `covered`: a topic lies on it, and its own words step back.
    private func centre(covered: Bool) -> some View {
        // all of them: what is listed carries every one
        let names = NetLayout.together(chosen)
        return Button { choose(Array(chosen.dropLast())) } label: {
            label(names.joined(separator: " +\n"), count: articles, font: names.count > 1 ? .footnote.weight(.semibold) : .headline, lines: max(1, names.count))
                .opacity(covered ? 0 : 1)
                .frame(width: NetLayout.centre * 2, height: NetLayout.centre * 2)
                .foregroundStyle(Color(.systemBackground))
                .background(Circle().fill(KaivoTokens.accent))
                .contentShape(Circle())
        }
        .buttonStyle(PressedBubble(reduceMotion: reduceMotion))
        .accessibilityLabel("Topic \(names.joined(separator: " + "))")
        .accessibilityValue(Text(verbatim: articles.formatted()))
        .accessibilityHint("Goes back one step")
        .accessibilityAddTraits(.isSelected)
    }

    // no Button: its tap would also fire at the end of a pull, wherever the topic was let go
    private func satellite(_ topic: TopicBubbles.Topic, radius: CGFloat) -> some View {
        label(topic.name, count: topic.count, font: .footnote.weight(.semibold))
            .frame(width: radius * 2, height: radius * 2)
            .foregroundStyle(Color.primary)
            // opaque underneath, so that the line ends at the rim
            .background(ZStack { Circle().fill(Color(.systemBackground)); Circle().fill(KaivoTokens.accent.opacity(0.24)) })
            .contentShape(Circle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Topic \(topic.name)")
            .accessibilityValue(Text(verbatim: topic.count.formatted()))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { choose(chosen + [topic.name]) }
    }

    private func label(_ name: String, count: Int, font: Font, lines: Int = 1) -> some View {
        VStack(spacing: 0) {
            Text(verbatim: name).font(font).lineLimit(lines).multilineTextAlignment(.center).minimumScaleFactor(0.5)
            Text(verbatim: count.formatted()).font(.caption2).opacity(0.8)
        }
        .padding(5)
    }

    private func choose(_ next: [String]) {
        withAnimation(reduceMotion ? nil : .snappy) { chosen = next }
    }
}
