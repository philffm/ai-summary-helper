import SwiftUI
import UIKit

/// How articles are set: size, typeface, line spacing and background. One choice for every article, kept on the device.
/// With nothing chosen, an article looks as the system sets it, in New York.
struct ReaderLook: Equatable {
    enum Face: String, CaseIterable, Identifiable {
        case serif, sans, easy, hanken
        var id: Self { self }
        /// The name of the typeface, the same in every language.
        var name: String {
            switch self {
            case .serif: "New York"
            case .sans: "San Francisco"
            case .easy: "Atkinson"
            case .hanken: "Hanken"
            }
        }
        var kind: LocalizedStringKey {
            switch self {
            case .serif: "Default"
            case .sans: "Sans serif"
            case .easy: "Easy to read"
            case .hanken: "As in the browser"
            }
        }
        /// The face at a fixed size, to show what it looks like.
        func sample(_ size: CGFloat) -> Font {
            switch self {
            case .serif: .system(size: size, design: .serif)
            case .sans: .system(size: size)
            case .easy: .custom("AtkinsonHyperlegible-Regular", fixedSize: size)
            case .hanken: .custom("HankenGrotesk-Regular", fixedSize: size)
            }
        }
    }

    enum Spacing: String, CaseIterable, Identifiable {
        case tight, normal, airy
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self {
            case .tight: "Tight"
            case .normal: "Normal"
            case .airy: "Airy"
            }
        }
    }

    /// The page behind the words. Apart from "auto", a page stays as chosen in light and in dark appearance.
    /// The colours are those of the Android reader (ReaderLook in ReaderStyle.kt).
    enum Ground: String, CaseIterable, Identifiable {
        case auto, paper, white, dark
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self {
            case .auto: "Auto"
            case .paper: "Paper"
            case .white: "White"
            case .dark: "Dark"
            }
        }
        var page: Color? {
            switch self {
            case .auto: nil
            case .paper: Color(lightARGB: 0xFFF4ECD8, darkARGB: 0xFFF4ECD8)
            case .white: Color(lightARGB: 0xFFFFFFFF, darkARGB: 0xFFFFFFFF)
            case .dark: Color(lightARGB: 0xFF121212, darkARGB: 0xFF121212)
            }
        }
        var ink: UIColor {
            switch self {
            case .auto: .label
            case .paper: Self.paperInk
            case .white: Self.whiteInk
            case .dark: Self.darkInk
            }
        }
        // made once: a paragraph compares its colours to know whether it must be set again
        private static let paperInk = UIColor(red: 0x3B / 255, green: 0x32 / 255, blue: 0x26 / 255, alpha: 1)
        private static let whiteInk = UIColor(white: 0x11 / 255, alpha: 1)
        private static let darkInk = UIColor(white: 0xE6 / 255, alpha: 1)
        /// Light or dark for everything on the page: highlights, links, the rail and the bars. nil follows the system.
        var scheme: ColorScheme? {
            switch self {
            case .auto: nil
            case .paper, .white: .light
            case .dark: .dark
            }
        }
    }

    /// Steps of the system's text size, to either side of the reader's own setting.
    static let steps = -3...5

    var step = 0
    var face = Face.serif
    var spacing = Spacing.normal
    var ground = Ground.auto

    static func label(of step: Int) -> String {
        step > 0 ? "+\(step)" : step < 0 ? "−\(-step)" : "0"
    }

    /// The system's text size, moved by the chosen steps.
    func size(from system: DynamicTypeSize) -> DynamicTypeSize {
        let all = DynamicTypeSize.allCases
        guard let at = all.firstIndex(of: system) else { return system }
        return all[min(max(at + step, 0), all.count - 1)]
    }

    func font(_ style: UIFont.TextStyle, bold: Bool = false, system: DynamicTypeSize) -> UIFont {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(size(from: system)))
        let base = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style, compatibleWith: traits)
        switch face {
        case .serif, .sans:
            let designed = face == .serif ? base.withDesign(.serif) ?? base : base
            return UIFont(descriptor: bold ? designed.withSymbolicTraits(.traitBold) ?? designed : designed, size: 0)
        case .easy:
            return UIFont(name: bold ? "AtkinsonHyperlegible-Bold" : "AtkinsonHyperlegible-Regular", size: base.pointSize)
                ?? UIFont(descriptor: base, size: 0)
        case .hanken:
            guard UIFont(name: "HankenGrotesk-Regular", size: base.pointSize) != nil else { return UIFont(descriptor: base, size: 0) }
            // one file with every weight: the weight is set along its axis ('wght')
            let weighted = UIFontDescriptor(fontAttributes: [
                .name: "HankenGrotesk-Regular",
                UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [0x77676874: bold ? 700 : 400],
            ])
            return UIFont(descriptor: weighted, size: base.pointSize)
        }
    }

    /// Extra points between the lines of a text set in this size.
    func lineSpacing(for points: CGFloat) -> CGFloat {
        switch spacing {
        case .tight: 0
        case .normal: 4
        case .airy: (points * 0.55).rounded()
        }
    }

    /// The text size used to be one of three words.
    static func migrate(_ defaults: UserDefaults = .standard) {
        guard let old = defaults.string(forKey: "readerTextSize") else { return }
        if defaults.object(forKey: StoredReaderLook.stepKey) == nil {
            defaults.set(old == "Small" ? -1 : old == "Large" ? 2 : 0, forKey: StoredReaderLook.stepKey)
        }
        defaults.removeObject(forKey: "readerTextSize")
    }
}

/// The chosen look as it is stored; a view that holds one follows every change.
struct StoredReaderLook: DynamicProperty {
    static let stepKey = "readerSizeStep"

    @AppStorage(StoredReaderLook.stepKey) var step = 0
    @AppStorage("readerFace") var face = ReaderLook.Face.serif
    @AppStorage("readerSpacing") var spacing = ReaderLook.Spacing.normal
    @AppStorage("readerGround") var ground = ReaderLook.Ground.auto

    var look: ReaderLook {
        ReaderLook(step: min(max(step, ReaderLook.steps.lowerBound), ReaderLook.steps.upperBound), face: face, spacing: spacing, ground: ground)
    }

    func reset() {
        step = 0
        face = .serif
        spacing = .normal
        ground = .auto
    }
}

/// Text of an article in the chosen face and size, for what SwiftUI draws itself (the paragraphs are a UITextView).
private struct ReaderText: ViewModifier {
    let look: ReaderLook
    let title: Bool
    @Environment(\.dynamicTypeSize) private var system

    func body(content: Content) -> some View {
        content.font(font).dynamicTypeSize(look.size(from: system))
            .foregroundStyle(look.ground.page == nil ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(uiColor: look.ground.ink)))
    }

    private var font: Font {
        switch look.face {
        case .serif, .sans:
            let design: Font.Design = look.face == .serif ? .serif : .default
            return title ? .system(.title, design: design).weight(.semibold) : .system(.body, design: design)
        case .easy, .hanken:
            return Font(look.font(title ? .title1 : .body, bold: title, system: system) as CTFont)
        }
    }
}

/// The page of a reader: its background, and light or dark for what lies on it. (The ink goes with the text.)
private struct ReaderPage: ViewModifier {
    let ground: ReaderLook.Ground
    @Environment(\.colorScheme) private var system
    @Environment(\.tabsStay) private var wide
    @State private var shown = false

    func body(content: Content) -> some View {
        // the same modifiers for every ground: another set of views would lose the place in the article
        content
            // on a wide window not to the sides: a list stands there, and its words are made for its own ground
            .background { (ground.page ?? .clear).ignoresSafeArea(edges: wide ? .vertical : .all) }
            .environment(\.colorScheme, ground.scheme ?? system)
            .toolbarColorScheme(ground.scheme, for: .navigationBar, .bottomBar)
            // a wide window shows the list and the clock too, which the page does not reach: dark paper darkens it all,
            // or the clock would stand white on white
            // only while the article is on screen: another tab keeps the system's appearance
            .preferredColorScheme(wide && shown && ground == .dark ? .dark : nil)
            .onAppear { shown = true }
            .onDisappear { shown = false }
    }
}

extension View {
    func readerText(_ look: ReaderLook, title: Bool = false) -> some View { modifier(ReaderText(look: look, title: title)) }
    func readerPage(_ ground: ReaderLook.Ground) -> some View { modifier(ReaderPage(ground: ground)) }
}
