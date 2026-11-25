import SwiftUI
import UIKit

/// A paragraph with the system's own text selection: press a word, drag the handles, and the menu offers to highlight
/// exactly those words (always whole ones).
struct PassageText: UIViewRepresentable {
    let passage: Passage
    let style: UIFont.TextStyle
    let highlight: (NSRange) -> Void
    let unmark: (NSRange) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(usingTextLayoutManager: false)
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        let text = attributed()
        if view.attributedText != text { view.attributedText = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0, width < .infinity else { return nil }
        return CGSize(width: width, height: uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    }

    func attributed() -> NSAttributedString {
        let base = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style)
        let font = UIFont(descriptor: base.withDesign(.serif) ?? base, size: 0)
        let lines = NSMutableParagraphStyle()
        lines.lineSpacing = 4
        let result = NSMutableAttributedString(string: passage.text, attributes: [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: lines])
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

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: PassageText
        init(_ parent: PassageText) { self.parent = parent }

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
