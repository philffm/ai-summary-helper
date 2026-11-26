import SwiftUI
import UIKit

/// Press and pull, inside a list that scrolls. SwiftUI's own long press followed by a drag swallows every swipe that
/// begins on the view, so from iOS 18 on the system's recognizer does it: it gives way to scrolling until the finger has
/// rested for a moment. (On iOS 17 tapping does the same job, without pulling.)
struct Pull: ViewModifier {
    enum Phase {
        /// How far the finger has come, and where it is (in the space named "net").
        case moved(CGSize, CGPoint)
        case ended(CGPoint)
        case cancelled
    }

    let action: (Phase) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(PressAndPull(action: action))
        } else {
            content
        }
    }
}

@available(iOS 18.0, *)
private struct PressAndPull: UIGestureRecognizerRepresentable {
    let action: (Pull.Phase) -> Void

    final class Coordinator { var start = CGPoint.zero }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let press = UILongPressGestureRecognizer()
        press.minimumPressDuration = 0.25
        return press
    }

    func handleUIGestureRecognizerAction(_ press: UILongPressGestureRecognizer, context: Context) {
        let point = context.converter.location(in: .named("net"))
        // the finger's own way on the screen: the view moves along with it, so positions inside the view would not do
        let finger = press.location(in: nil)
        switch press.state {
        case .began:
            context.coordinator.start = finger
            action(.moved(.zero, point))
        case .changed:
            action(.moved(CGSize(width: finger.x - context.coordinator.start.x, height: finger.y - context.coordinator.start.y), point))
        case .ended:
            action(.ended(point))
        default:
            action(.cancelled)
        }
    }
}
