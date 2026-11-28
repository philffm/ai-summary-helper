import Foundation
import Observation

/// The questions being asked about articles: one at a time for each article, with the model that writes summaries. A
/// question goes on when the reader moves elsewhere.
@MainActor
@Observable
final class Questions {
    /// What is being asked, by article.
    private(set) var asking: [Article.ID: Asking] = [:]
    /// Articles whose last answer was written from the beginning of the text only.
    private(set) var cut: Set<Article.ID> = []
    /// The question answered last, which is shown unfolded.
    private(set) var latest: [Article.ID: String] = [:]
    /// A prepared short answer a model can be asked to go further with.
    private(set) var short: [Article.ID: String] = [:]
    var failure: String?
    /// Waiting for the reader's yes before anything is sent.
    var consentFor: Waiting?
    var consent = AIConsent()
    @ObservationIgnored var endpoint: () -> ModelEndpoint? = { ModelEndpoint.current }
    @ObservationIgnored var ask: (ModelEndpoint, String, String) async throws -> String = { try await ModelClient().ask($0, system: $1, user: $2) }
    /// Prepared answers that are being written down.
    @ObservationIgnored private var taking: Set<Article.ID> = []

    struct Asking: Equatable {
        var question: String
        /// The short answer being continued; nil for a new question.
        var turn: String?
    }

    struct Waiting: Equatable {
        var article: Article.ID
        var question: String
        var turn: String?
        var endpoint: ModelEndpoint
    }

    /// A question about an article; with `turn`, more about the short answer given to it. A prepared question that
    /// came with its answer needs no model. false: a model is needed and there is none.
    @discardableResult
    func send(_ question: String, about id: Article.ID, in library: Library, turn: String? = nil) -> Bool {
        let question = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, asking[id] == nil, !taking.contains(id) else { return true }
        if turn == nil, library.article(id)?.openSuggestions.contains(where: { $0.question == question && $0.answer?.isEmpty == false }) == true {
            taking.insert(id)
            Task {
                defer { taking.remove(id) }
                do {
                    guard let written = try await library.quickAnswer(id, question: question) else { return }
                    latest[id] = written
                    short[id] = written
                } catch {
                    failure = error.localizedDescription
                }
            }
            return true
        }
        guard let endpoint = endpoint() else { return false }
        if consent.isNeeded(for: endpoint) {
            consentFor = Waiting(article: id, question: question, turn: turn, endpoint: endpoint)
            return true
        }
        asking[id] = Asking(question: question, turn: turn)
        Task { await work(question, turn, id, endpoint, library) }
        return true
    }

    func answer(_ waiting: Waiting, allow: Bool, in library: Library) {
        consentFor = nil
        guard allow else { return }
        consent.allow(waiting.endpoint)
        send(waiting.question, about: waiting.article, in: library, turn: waiting.turn)
    }

    private func work(_ question: String, _ turn: String?, _ id: Article.ID, _ endpoint: ModelEndpoint, _ library: Library) async {
        defer { asking[id] = nil }
        // the model on the device takes a fraction of what a server does
        let small = endpoint.format == .device
        let text = library.article(id)?.passages.map(\.text).joined(separator: " ") ?? ""
        var chars = small ? DeviceModel.parts(for: text).size + 2000 : 20_000
        if small && DeviceModel.parts(for: text).size < 3000 { chars = 2200 }
        let earlier = small ? 2 : 6
        do {
            var prompt = try await library.askPrompt(id, question: question, turn: turn, chars: chars, earlier: earlier)
            let reply: String
            do {
                reply = try await ask(endpoint, prompt.system, prompt.user)
            } catch DeviceModel.Failure.tooLong {
                // once more with half the text
                prompt = try await library.askPrompt(id, question: question, turn: turn, chars: chars / 2, earlier: 0)
                reply = try await ask(endpoint, prompt.system, prompt.user)
            }
            latest[id] = try await library.answer(id, question: question, reply: reply, turn: turn)
            short[id] = nil
            if prompt.cut { cut.insert(id) } else { cut.remove(id) }
        } catch {
            failure = error.localizedDescription
        }
    }
}
