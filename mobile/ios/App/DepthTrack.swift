import Observation
import SwiftUI

/// Where things lie along an article, as fractions from 0 (top) to 1 (end). Length is counted in characters; a picture
/// counts as a short paragraph.
enum DepthTrack {
    struct Spot: Identifiable, Equatable {
        var id: Mark.ID
        var passage: Passage.ID
        var from: Double
        var to: Double
        var ai: Bool
    }

    static func weight(_ passage: Passage) -> Double { passage.kind == .image ? 400 : Double(max(1, passage.text.utf16.count)) }

    /// The start of every passage, and the total.
    static func starts(_ passages: [Passage]) -> ([Double], Double) {
        var at = 0.0
        let list = passages.map { passage -> Double in
            defer { at += weight(passage) }
            return at
        }
        return (list, max(1, at))
    }

    static func spots(_ passages: [Passage]) -> [Spot] {
        let (start, total) = starts(passages)
        return passages.enumerated().flatMap { index, passage in
            passage.marks.map { mark in
                Spot(id: mark.id, passage: passage.id, from: (start[index] + Double(mark.start)) / total,
                     to: min(1, (start[index] + Double(mark.start + mark.length)) / total), ai: mark.ai)
            }
        }
    }

    /// The part on screen. `visible` holds, per passage index, how much of it lies above the screen's top edge and how
    /// much of it lies above the bottom edge (both 0 to 1).
    /// `measured` spares counting the whole article again for every frame of a scroll.
    static func window(_ passages: [Passage], visible: [Int: (above: Double, upTo: Double)],
                       measured: ([Double], Double)? = nil) -> ClosedRange<Double>? {
        let (start, total) = measured ?? starts(passages)
        let shown = visible.keys.filter { $0 >= 0 && $0 < passages.count }.sorted()
        guard let first = shown.first, let last = shown.last, let top = visible[first], let bottom = visible[last] else { return nil }
        let from = (start[first] + weight(passages[first]) * top.above) / total
        let to = (start[last] + weight(passages[last]) * bottom.upTo) / total
        return min(from, to)...min(1, max(from, to))
    }

    /// The passage that lies at a fraction of the article.
    static func index(_ passages: [Passage], at fraction: Double) -> Int? {
        guard !passages.isEmpty else { return nil }
        let (start, total) = starts(passages)
        return start.lastIndex { $0 <= max(0, min(1, fraction)) * total } ?? 0
    }
}

/// What is on screen. Only the rail reads it, so scrolling does not redraw the article.
@Observable
final class ReadingPosition {
    var window: ClosedRange<Double> = 0...0
    @ObservationIgnored var frames: [Int: CGRect] = [:]
    @ObservationIgnored private var measured: (count: Int, track: ([Double], Double))?
    /// The furthest this reading has come; handed to the library only when the scrolling rests.
    @ObservationIgnored private(set) var reached = 0.0
    @ObservationIgnored private var resting: Task<Void, Never>?

    func reach(_ progress: Double, after rest: Duration = .seconds(1.5), save: @escaping @MainActor (Double) -> Void) {
        reached = max(reached, progress)
        resting?.cancel()
        resting = Task { @MainActor [weak self] in
            try? await Task.sleep(for: rest)
            guard let self, !Task.isCancelled else { return }
            save(reached)
        }
    }

    /// Leaving the article or the app: what is waiting is saved now.
    func settle(save: (Double) -> Void) {
        resting?.cancel()
        if reached > 0 { save(reached) }
    }

    func update(_ passages: [Passage], height: CGFloat) {
        var visible: [Int: (above: Double, upTo: Double)] = [:]
        for (index, frame) in frames where frame.height > 0 && frame.maxY > 0 && frame.minY < height {
            visible[index] = (max(0, min(1, -frame.minY / frame.height)), max(0, min(1, (height - frame.minY) / frame.height)))
        }
        if measured?.count != passages.count { measured = (passages.count, DepthTrack.starts(passages)) }
        guard let next = DepthTrack.window(passages, visible: visible, measured: measured?.track) else { return }
        if abs(next.lowerBound - window.lowerBound) > 0.004 || abs(next.upperBound - window.upperBound) > 0.004 { window = next }
    }
}

/// The depth rail at the edge of the reader: where the highlights lie and what is on screen. Tap or drag to go there.
struct DepthRail: View {
    let spots: [DepthTrack.Spot]
    let position: ReadingPosition
    /// To a highlight.
    let show: (DepthTrack.Spot) -> Void
    /// To any place of the article.
    let seek: (Double) -> Void
    @State private var ticks = 0
    @State private var current: Mark.ID?

    var body: some View {
        GeometryReader { geometry in
            let height = geometry.size.height
            ZStack(alignment: .top) {
                Capsule().fill(Color(.tertiarySystemFill)).frame(width: 10)
                ForEach(spots) { spot in
                    Capsule()
                        .fill(spot.ai ? KaivoTokens.savedNoteGhostBar : KaivoTokens.savedNoteUserBar)
                        .frame(width: current == spot.id ? 14 : 10, height: max(8, (spot.to - spot.from) * height))
                        .offset(y: min(spot.from * height, height - 8))
                }
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.55), lineWidth: 1.5)
                    .frame(width: 20, height: max(18, (position.window.upperBound - position.window.lowerBound) * height))
                    .offset(y: min(position.window.lowerBound * height, height - 18))
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                let fraction = max(0, min(1, value.location.y / max(1, height)))
                // a finger close to a highlight lands on it
                if let near = spots.min(by: { distance($0, fraction) < distance($1, fraction) }), distance(near, fraction) * height < 14 {
                    if current != near.id { current = near.id; ticks += 1; show(near) }
                } else {
                    current = nil
                    seek(fraction)
                }
            })
        }
        .frame(width: 28)
        .sensoryFeedback(.selection, trigger: ticks)
        .accessibilityElement()
        .accessibilityLabel("Highlights")
        .accessibilityValue("\(String((spots.firstIndex { $0.id == current } ?? -1) + 1)) of \(String(spots.count))")
        .accessibilityAdjustableAction { direction in
            let at = spots.firstIndex { $0.id == current } ?? -1
            let next = direction == .increment ? min(spots.count - 1, at + 1) : max(0, at - 1)
            guard spots.indices.contains(next) else { return }
            current = spots[next].id
            show(spots[next])
        }
    }

    private func distance(_ spot: DepthTrack.Spot, _ fraction: Double) -> Double {
        fraction < spot.from ? spot.from - fraction : fraction > spot.to ? fraction - spot.to : 0
    }
}
