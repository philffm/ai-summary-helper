import AVFoundation

/// The alarm's own sounds: the system plays a file from the app or from Library/Sounds, at most 30 seconds long.
enum WakeSound {
    static let well = "well.caf"
    static let own = "wake-own.caf"

    static var ownFile: URL {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appending(path: "Sounds/\(own)")
    }

    /// Copies the first 29 seconds of an audio file into the place and format the alarm can play.
    static func takeOver(_ source: URL) throws {
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let input = try AVAudioFile(forReading: source)
        let format = input.processingFormat
        try FileManager.default.createDirectory(at: ownFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temporary = ownFile.deletingLastPathComponent().appending(path: "new-" + own)
        try? FileManager.default.removeItem(at: temporary)
        do {
            let output = try AVAudioFile(forWriting: temporary, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
            ], commonFormat: format.commonFormat, interleaved: format.isInterleaved)
            var left = AVAudioFramePosition(format.sampleRate * 29)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 32768) else { throw CocoaError(.fileReadCorruptFile) }
            while left > 0, input.framePosition < input.length {
                try input.read(into: buffer, frameCount: AVAudioFrameCount(min(left, 32768)))
                if buffer.frameLength == 0 { break }
                try output.write(from: buffer)
                left -= AVAudioFramePosition(buffer.frameLength)
            }
        }   // closing the file writes its header
        try? FileManager.default.removeItem(at: ownFile)
        try FileManager.default.moveItem(at: temporary, to: ownFile)
    }
}
