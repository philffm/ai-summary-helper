import SwiftUI

/// What follows the alarm: the briefing or an article read aloud, or one of your highlights as a question.
struct WakePlayerView: View {
    let request: WakeRequest
    @Environment(\.dismiss) private var dismiss
    @Environment(Library.self) private var library
    @Environment(FeedsModel.self) private var feeds
    @Environment(Router.self) private var router
    @State private var content: WakeContent?
    @State private var voice = WakeVoice()
    @State private var revealed = false
    @State private var kept: Set<String> = []
    @Environment(\.horizontalSizeClass) private var width

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.04, green: 0.32, blue: 0.37), Color(red: 0.03, green: 0.08, blue: 0.09)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    kicker.font(.footnote.weight(.bold)).foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.headline).frame(width: 44, height: 44) }
                        .accessibilityLabel("Done")
                }
                switch content {
                case nil: ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                case .briefing(let stories): player(stories)
                case .article(let story): player([story])
                case .remember(let card, let cloze): question(card, cloze)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 12)
            .frame(maxWidth: width == .regular ? 1100 : 640)
        }
        .foregroundStyle(.white)
        .task { await load() }
        .onDisappear { voice.stop() }
    }

    private var kicker: Text {
        switch content {
        case .briefing(let stories) where !stories.isEmpty: Text("\(String(voice.index + 1)) of \(String(stories.count))")
        case .article: Text("From your library")
        case .remember: Text("Remember?")
        default: Text(verbatim: "Kaivo")
        }
    }

    private func build() -> WakeContent {
        WakeBuilder.content(request.mode, articles: library.articles, entries: feeds.entries, memos: WakeSettings.memos(), noBadNews: request.noBadNews,
                            seed: abs(request.id.hashValue % 100_000))
    }

    private func load() async {
        var next = build()
        // yesterday's feeds make a poor morning: fetch them first when the briefing is what is wanted
        if case .briefing = next {
            await feeds.refresh(ifOlderThan: 3 * 3600)
            next = build()
        }
        content = next
        switch next {
        case .briefing(let stories): voice.start(stories.map { [$0.source, $0.title] + $0.text })
        case .article(let story): voice.start([[story.title] + story.text])
        case .remember(_, let cloze): voice.start([[cloze.before + " … " + cloze.after]])   // the voice leaves the word out
        }
    }

    @ViewBuilder
    private func player(_ stories: [WakeStory]) -> some View {
        if stories.isEmpty {
            Spacer()
            Text("Nothing new in your feeds.").font(.system(.title, design: .serif))
            Spacer()
        } else {
            let story = stories[min(voice.index, stories.count - 1)]
            parts {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(verbatim: story.title).font(.system(.largeTitle, design: .serif))
                        Text(verbatim: story.source).font(.subheadline).foregroundStyle(.white.opacity(0.75))
                        ForEach(Array(story.text.enumerated()), id: \.offset) { _, paragraph in
                            Text(lit(paragraph)).font(.system(.title3, design: .serif)).lineSpacing(4)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .id(story.id)
            } controls: {
                VStack(spacing: 14) {
                    if stories.count > 1 {
                        HStack(spacing: 6) {
                            ForEach(stories.indices, id: \.self) { i in
                                Capsule().fill(i <= voice.index ? Color(red: 0.25, green: 0.65, blue: 0.7) : .white.opacity(0.25)).frame(height: 5)
                            }
                        }
                        .accessibilityHidden(true)
                    }
                    HStack(spacing: 10) {
                        quiet(voice.speaking ? "Pause" : "Play") { voice.toggle() }
                        if stories.count > 1 { quiet("Next") { voice.play((voice.index + 1) % stories.count) } }
                    }
                    if let entry = story.feed {
                        let saved = kept.contains(story.id) || library.contains(link: entry.stored.item.link)
                        strong(saved ? "Kept" : "Keep for later") { library.save(entry.stored.item, from: entry.feed); kept.insert(story.id) }
                            .disabled(saved)
                    } else if let id = story.articleID {
                        strong("Open the article") { open(id) }
                    }
                }
            }
        }
    }

    /// Text above, buttons below. Wide, they are two parts: beside each other, or on either side of the fold.
    @ViewBuilder
    private func parts(@ViewBuilder _ text: @escaping () -> some View, @ViewBuilder controls: @escaping () -> some View) -> some View {
        if width == .regular {
            TwoParts {
                // two parts are also what a half-open device shows: read from the upper or left one, like a bedside clock
                VStack(alignment: .leading, spacing: 8) {
                    Text(clock, style: .time).font(.system(size: 76, weight: .light)).accessibilityAddTraits(.isHeader)
                    text()
                }
                .padding(.horizontal, Gutter.half / 2)
            } second: {
                VStack {
                    Spacer(minLength: 0)
                    controls()   // in the middle of their half: clear of the fold and within reach
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Gutter.half / 2)
            }
        } else {
            text()
            controls()
        }
    }

    private var clock: Date {
        #if DEBUG
        // recordings show a morning hour, like the status bar the video scripts set
        if LaunchOptions.touches, let morning = Calendar.current.date(bySettingHour: 7, minute: 0, second: 0, of: .now) { return morning }
        #endif
        return .now
    }

    /// The paragraph with the sentence being read set off from the rest.
    private func lit(_ paragraph: String) -> AttributedString {
        var text = AttributedString(paragraph)
        if !voice.sentence.isEmpty, let range = text.range(of: voice.sentence) { text[range].backgroundColor = .white.opacity(0.22) }
        return text
    }

    @ViewBuilder
    private func question(_ card: RecallCard, _ cloze: Cloze) -> some View {
        Spacer()
        (Text(verbatim: cloze.before) + Text(verbatim: revealed ? cloze.answer : "\u{2007}\u{2007}\u{2007}\u{2007}\u{2007}\u{2007}").bold().underline() + Text(verbatim: cloze.after))
            .font(.system(.title, design: .serif))
            .lineSpacing(5)
            .accessibilityLabel(revealed ? Text(verbatim: card.text) : Text(verbatim: cloze.before) + Text(verbatim: " ") + Text("blank") + Text(verbatim: " ") + Text(verbatim: cloze.after))
        Text(verbatim: card.title).font(.subheadline).foregroundStyle(.white.opacity(0.75))
        Spacer()
        if revealed {
            HStack(spacing: 10) {
                quiet("Again soon") { WakeSettings.remember(card.key, knew: false); dismiss() }
                strong("I knew it") { WakeSettings.remember(card.key, knew: true); dismiss() }
            }
        } else {
            strong("Show the word") { revealed = true; voice.start([[card.text]]) }
        }
        quiet("Open the article") { open(card.articleID) }
    }

    private func open(_ id: String) {
        voice.stop()
        dismiss()
        router.open(.article(id))
    }

    private func strong(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.headline).frame(maxWidth: .infinity, minHeight: 54) }
            .background(Color(red: 0.25, green: 0.65, blue: 0.7), in: Capsule())
            .foregroundStyle(Color(red: 0.03, green: 0.08, blue: 0.09))
    }

    private func quiet(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.headline).frame(maxWidth: .infinity, minHeight: 54) }
            .background(.white.opacity(0.18), in: Capsule())
    }
}
