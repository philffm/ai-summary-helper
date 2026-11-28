import SwiftUI
import UIKit

/// A paragraph with the system's own text selection: press a word, drag the handles, and the menu offers to highlight
/// exactly those words (always whole ones).
struct PassageText: UIViewRepresentable {
    let passage: Passage
    let style: UIFont.TextStyle
    var look = ReaderLook()
    /// The system's text size; the look moves from there.
    var textSize = DynamicTypeSize.large
    /// In a research paper, numbers such as [3] step back behind the words.
    var citations = false
    let highlight: (NSRange) -> Void
    let unmark: (NSRange) -> Void
    /// Keeps (true) or dismisses a suggestion of the AI: offered where it is tapped.
    let resolve: (Mark.ID, Bool) -> Void
    /// Writes on a highlight: offered where one is tapped; nil where highlights cannot be written on.
    var comment: ((Mark.ID) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(usingTextLayoutManager: false)
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        // the size comes with the font: the view must not set it back to the system's
        view.adjustsFontForContentSizeCategory = false
        view.delegate = context.coordinator
        let menu = UIEditMenuInteraction(delegate: context.coordinator)
        view.addInteraction(menu)
        context.coordinator.menu = menu
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped))
        tap.delegate = context.coordinator
        // the text view keeps its own taps, for selecting words
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        // highlights and system colours resolve for the page they lie on
        view.overrideUserInterfaceStyle = look.ground.scheme.map { $0 == .dark ? .dark : .light } ?? .unspecified
        let text = attributed()
        if view.attributedText != text { view.attributedText = text }
        // VoiceOver cannot point at a sentence: each suggestion is offered as actions of its paragraph
        view.accessibilityCustomActions = passage.marks.filter(\.ai).flatMap { mark in
            let words = String(passage.words(of: mark).prefix(60))
            return [(String(localized: "Keep"), true), (String(localized: "Dismiss"), false)].map { name, keep in
                UIAccessibilityCustomAction(name: name + ": " + words) { _ in
                    context.coordinator.parent.resolve(mark.id, keep)
                    return true
                }
            }
        }
        // added to what the text view already is: replacing its traits would take the selection away from VoiceOver
        if passage.heading != nil { view.accessibilityTraits.insert(.header) }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0, width < .infinity else { return nil }
        return CGSize(width: width, height: uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    }

    func attributed() -> NSAttributedString {
        let font = look.font(style, bold: passage.heading != nil, system: textSize)
        let lines = NSMutableParagraphStyle()
        lines.lineSpacing = look.lineSpacing(for: font.pointSize)
        let result = NSMutableAttributedString(string: passage.text, attributes: [.font: font, .foregroundColor: look.ground.ink, .paragraphStyle: lines])
        if citations {
            let quiet = look.ground.page == nil ? UIColor.secondaryLabel : look.ground.ink.withAlphaComponent(0.6)
            for range in PaperSense.citations(in: passage.text) { result.addAttribute(.foregroundColor, value: quiet, range: range) }
        }
        for mark in passage.marks where mark.start >= 0 && mark.start + mark.length <= result.length {
            if mark.ai {
                result.addAttributes([.backgroundColor: UIColor(KaivoTokens.savedNoteGhostBg), .foregroundColor: UIColor(KaivoTokens.savedNoteGhostFg),
                                      .underlineStyle: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDash.rawValue,
                                      .underlineColor: UIColor(KaivoTokens.savedNoteGhostBar)], range: mark.range)
            } else {
                result.addAttributes([.backgroundColor: UIColor(KaivoTokens.savedNoteUserBg), .foregroundColor: UIColor(KaivoTokens.savedNoteUserFg)], range: mark.range)
            }
        }
        return result
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate, UIEditMenuInteractionDelegate {
        var parent: PassageText
        weak var menu: UIEditMenuInteraction?
        /// The highlight the menu is about, and where its words lie.
        private var asked: (id: Mark.ID, frame: CGRect)?
        init(_ parent: PassageText) { self.parent = parent }

        @objc func tapped(_ tap: UITapGestureRecognizer) {
            guard let view = tap.view as? UITextView, view.selectedRange.length == 0 else { return }
            let point = tap.location(in: view)
            let layout = view.layoutManager, container = view.textContainer
            let glyph = layout.glyphIndex(for: point, in: container)
            // the nearest glyph is not enough: a tap beside the words means nothing
            guard layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).insetBy(dx: -6, dy: -6).contains(point) else { return }
            let character = layout.characterIndexForGlyph(at: glyph)
            // the reader's own highlights offer something only where they can be written on
            guard let mark = parent.passage.marks.first(where: { ($0.ai || parent.comment != nil) && NSLocationInRange(character, $0.range) }) else { return }
            let words = layout.glyphRange(forCharacterRange: mark.range, actualCharacterRange: nil)
            // the line that was tapped, so that the menu stands beside the finger, also for a long suggestion
            var line = NSRange()
            let lineFrame = layout.lineFragmentUsedRect(forGlyphAt: glyph, effectiveRange: &line)
            let part = NSIntersectionRange(words, line)
            asked = (mark.id, part.length > 0 ? layout.boundingRect(forGlyphRange: part, in: container) : lineFrame)
            menu?.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let id = asked?.id, let mark = parent.passage.marks.first(where: { $0.id == id }) else { return nil }
            let write = parent.comment == nil ? [] : [UIAction(title: String(localized: "Comment"), image: UIImage(systemName: "text.bubble")) { [weak self] _ in
                self?.parent.comment?(id)
            }]
            guard mark.ai else {
                return UIMenu(children: write + [UIAction(title: String(localized: "Remove highlight"), image: UIImage(systemName: "eraser")) { [weak self] _ in
                    guard let self, let mark = parent.passage.marks.first(where: { $0.id == id }) else { return }
                    parent.unmark(mark.range)
                }])
            }
            return UIMenu(children: [
                UIAction(title: String(localized: "Keep"), image: UIImage(systemName: "checkmark")) { [weak self] _ in
                    self?.parent.resolve(id, true)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                },
                UIAction(title: String(localized: "Dismiss"), image: UIImage(systemName: "xmark")) { [weak self] _ in self?.parent.resolve(id, false) },
            ] + write)
        }

        func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect {
            asked?.frame ?? .null
        }

        func textView(_ view: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard range.length > 0, parent.passage.wholeWords(range) != nil else { return UIMenu(children: suggestedActions) }
            var own: [UIMenuElement] = [UIAction(title: String(localized: "Highlight"), image: UIImage(systemName: "highlighter")) { [weak self, weak view] _ in
                self?.parent.highlight(range)
                view?.selectedTextRange = nil
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }]
            if parent.passage.isMarked(range) {
                own.append(UIAction(title: String(localized: "Remove highlight"), image: UIImage(systemName: "eraser")) { [weak self, weak view] _ in
                    self?.parent.unmark(range)
                    view?.selectedTextRange = nil
                })
            }
            return UIMenu(children: own + suggestedActions)
        }
    }
}
