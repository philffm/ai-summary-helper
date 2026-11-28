import SwiftUI

/// What a reader may be asked or told while summaries and answers are written: the yes before text is sent, what went
/// wrong, and the way to set a model up. Shown by whatever is in front, the article or its menu.
struct ReaderPrompts: ViewModifier {
    let id: Article.ID
    let active: Bool
    @Binding var showServer: Bool

    @Environment(Library.self) private var library
    @Environment(Summaries.self) private var summaries
    @Environment(Questions.self) private var questions

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $showServer) { NavigationStack { ModelServerView(closable: true) } }
            .alert("Send text to an AI service?",
                   isPresented: Binding(get: { active && summaries.question?.article == id }, set: { if !$0 && active { summaries.question = nil } }),
                   presenting: summaries.question) { question in
                Button("Allow") { summaries.answer(question, allow: true, in: library) }
                Button("Not now", role: .cancel) { summaries.answer(question, allow: false, in: library) }
            } message: { question in
                Text("To write the summary, Kaivo sends the text of this article to \(question.endpoint.recipient). Nothing is sent before you allow it.")
            }
            .alert("Send text to an AI service?",
                   isPresented: Binding(get: { active && questions.consentFor?.article == id }, set: { if !$0 && active { questions.consentFor = nil } }),
                   presenting: questions.consentFor) { waiting in
                Button("Allow") { questions.answer(waiting, allow: true, in: library) }
                Button("Not now", role: .cancel) { questions.answer(waiting, allow: false, in: library) }
            } message: { waiting in
                Text("To answer, Kaivo sends the text of this article and your question to \(waiting.endpoint.recipient). Nothing is sent before you allow it.")
            }
            .alert("No answer", isPresented: Binding(get: { active && questions.failure != nil }, set: { if !$0 && active { questions.failure = nil } })) {
                Button("Model") { showServer = true }
                Button("OK", role: .cancel) {}
            } message: {
                Text(verbatim: questions.failure ?? "")
            }
            .alert("No summary", isPresented: Binding(get: { active && summaries.failure != nil }, set: { if !$0 && active { summaries.failure = nil } })) {
                Button("Model") { showServer = true }
                Button("OK", role: .cancel) {}
            } message: {
                Text(verbatim: summaries.failure ?? "")
            }
    }
}
