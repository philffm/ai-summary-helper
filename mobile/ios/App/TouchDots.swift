#if DEBUG
import UIKit

/// Debug only (`-KaivoTouches YES`): shows where the screen is touched, for the App Store preview recording (Apple allows
/// touch indicators there). It watches the touches and never takes them.
final class TouchDots: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private var dots: [UITouch: UIView] = [:]

    static func install() {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first,
              !(window.gestureRecognizers ?? []).contains(where: { $0 is TouchDots }) else { return }
        let watcher = TouchDots()
        watcher.cancelsTouchesInView = false
        watcher.delaysTouchesEnded = false
        watcher.delegate = watcher
        window.addGestureRecognizer(watcher)
    }

    func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    override func canPrevent(_ other: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by other: UIGestureRecognizer) -> Bool { false }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let window = view as? UIWindow else { return }
        for touch in touches {
            let dot = UIView(frame: CGRect(x: 0, y: 0, width: 54, height: 54))
            dot.center = touch.location(in: window)
            dot.isUserInteractionEnabled = false
            dot.backgroundColor = UIColor.black.withAlphaComponent(0.2)
            dot.layer.cornerRadius = 27
            dot.layer.borderWidth = 2.5
            dot.layer.borderColor = UIColor.white.cgColor
            dot.layer.zPosition = 10_000
            dot.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)
            window.addSubview(dot)
            UIView.animate(withDuration: 0.18) { dot.transform = .identity }
            dots[touch] = dot
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        for touch in touches { dots[touch]?.center = touch.location(in: view) }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { release(touches) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { release(touches) }

    private func release(_ touches: Set<UITouch>) {
        for touch in touches {
            guard let dot = dots.removeValue(forKey: touch) else { continue }
            // stays a moment, so that a quick tap is seen
            UIView.animate(withDuration: 0.35, delay: 0.2, options: []) {
                dot.alpha = 0
                dot.transform = CGAffineTransform(scaleX: 1.6, y: 1.6)
            } completion: { _ in dot.removeFromSuperview() }
        }
        if dots.isEmpty { state = .failed }
    }
}
#endif
