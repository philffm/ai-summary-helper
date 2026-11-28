import AVFoundation
import XCTest
@testable import Kaivo

/// A text is read in its own language, whatever the device is set to.
final class VoicesTests: XCTestCase {
    private let voices = [Voices.Voice(id: "samantha", language: "en-US", quality: 1), Voices.Voice(id: "daniel", language: "en-GB", quality: 1),
                          Voices.Voice(id: "anna", language: "de-DE", quality: 1), Voices.Voice(id: "petra", language: "de-DE", quality: 2),
                          Voices.Voice(id: "kyoko", language: "ja-JP", quality: 1), Voices.Voice(id: "tingting", language: "zh-CN", quality: 1),
                          Voices.Voice(id: "meijia", language: "zh-TW", quality: 1), Voices.Voice(id: "luciana", language: "pt-BR", quality: 1)]
    private let german = "Im Tiefschlaf geht das Gehirn den Tag noch einmal durch. Ein kurzer Rückblick am Morgen hilft."
    private let english = "During deep sleep the brain goes over the day again. A short review the next morning helps."

    private func choose(_ text: String, device: String, preferred: [String] = [], standard: [String: String] = [:], from: [Voices.Voice]? = nil) -> String? {
        Voices.choose(for: text, from: from ?? voices, device: device, preferred: preferred, standard: { standard[$0] })
    }

    func testTheTextsLanguageDecides() {
        XCTAssertEqual(choose(german, device: "en-US"), "petra", "the better voice that was loaded")
        XCTAssertEqual(choose(english, device: "de-DE", standard: ["en-US": "samantha"]), "samantha")
        XCTAssertEqual(choose(english, device: "de-DE", preferred: ["de-DE", "en-GB"]), "daniel", "the reader's own English")
        XCTAssertEqual(choose("眠っている間に、脳はその日の出来事をもう一度たどります。", device: "de-DE"), "kyoko")
        XCTAssertEqual(choose("睡眠时，大脑会重新整理一天中发生的事情，这有助于记忆。", device: "de-DE"), "tingting")
        XCTAssertEqual(choose("睡覺時，大腦會重新整理一天中發生的事情，這有助於記憶。", device: "de-DE"), "meijia")
        XCTAssertEqual(choose("Durante o sono profundo, o cérebro repassa o dia. Uma revisão curta pela manhã ajuda muito.", device: "de-DE"), "luciana")
    }

    func testTheDevicesVoiceStaysForItsOwnLanguage() {
        XCTAssertNil(choose(german, device: "de-DE"))
        XCTAssertNil(choose(english, device: "en-GB"))
        XCTAssertNil(choose(german, device: "en-US", from: []), "no voice speaks it")
        XCTAssertNil(choose("", device: "en-US"))
    }

    func testTheSystemHasTheseVoices() throws {
        // on a device or simulator: a text in another language gets a voice of that language
        let other = AVSpeechSynthesisVoice.currentLanguageCode().hasPrefix("de") ? (english, "en") : (german, "de")
        XCTAssertEqual(try XCTUnwrap(Voices.voice(for: other.0)).language.prefix(2), Substring(other.1))
    }
}
