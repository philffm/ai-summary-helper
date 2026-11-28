import CommonCrypto
import CryptoKit
import Foundation
import zlib

/// What the sync modules get from a browser's Web Crypto and compression streams, with the same bytes in and out.
enum SyncPrimitives {
    static func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

    static func hmac(key: Data, _ data: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
    }

    static func hkdf(master: Data, salt: Data, info: Data, count: Int) -> Data {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: master), salt: salt, info: info, outputByteCount: count)
            .withUnsafeBytes { Data($0) }
    }

    static func pbkdf2(password: Data, salt: Data, iterations: Int, count: Int) -> Data? {
        guard iterations > 0, count > 0 else { return nil }
        var out = Data(count: count)
        let status = out.withUnsafeMutableBytes { key in
            password.withUnsafeBytes { secret in
                salt.withUnsafeBytes { salt in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), secret.bindMemory(to: CChar.self).baseAddress, password.count,
                                         salt.bindMemory(to: UInt8.self).baseAddress, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                                         UInt32(iterations), key.bindMemory(to: UInt8.self).baseAddress, count)
                }
            }
        }
        return status == kCCSuccess ? out : nil
    }

    /// Web Crypto's form: the ciphertext followed by the 16-byte tag; the nonce travels on its own.
    static func aesGcmSeal(key: Data, nonce: Data, _ plain: Data) -> Data? {
        guard let nonce = try? AES.GCM.Nonce(data: nonce),
              let box = try? AES.GCM.seal(plain, using: SymmetricKey(data: key), nonce: nonce) else { return nil }
        return box.ciphertext + box.tag
    }

    static func aesGcmOpen(key: Data, nonce: Data, _ sealed: Data) -> Data? {
        guard sealed.count >= 16, let nonce = try? AES.GCM.Nonce(data: nonce),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: sealed.dropLast(16), tag: sealed.suffix(16)) else { return nil }
        return try? AES.GCM.open(box, using: SymmetricKey(data: key))
    }

    static func random(_ count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<max(0, count)).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }

    /// gzip with its header and checksum (window bits 31); Apple's Compression framework would leave both out.
    static func gzip(_ data: Data) -> Data? {
        var stream = z_stream()
        guard deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION,
                            Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { deflateEnd(&stream) }
        return pump(&stream, data, limit: .max) { deflate($0, Z_FINISH) }
    }

    /// `limit`: more than this is not accepted from a file of a few bytes.
    static func gunzip(_ data: Data, limit: Int = 64 * 1024 * 1024) -> Data? {
        var stream = z_stream()
        guard inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { inflateEnd(&stream) }
        return pump(&stream, data, limit: limit) { inflate($0, Z_NO_FLUSH) }
    }

    private static func pump(_ stream: inout z_stream, _ input: Data, limit: Int, _ step: (UnsafeMutablePointer<z_stream>) -> Int32) -> Data? {
        var output = Data()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        var source = [UInt8](input)
        let ok = source.withUnsafeMutableBufferPointer { source -> Bool in
            stream.next_in = source.baseAddress
            stream.avail_in = uInt(source.count)
            while true {
                let code = chunk.withUnsafeMutableBufferPointer { chunk -> Int32 in
                    stream.next_out = chunk.baseAddress
                    stream.avail_out = uInt(chunk.count)
                    return withUnsafeMutablePointer(to: &stream, step)
                }
                output.append(contentsOf: chunk[0 ..< chunk.count - Int(stream.avail_out)])
                if output.count > limit { return false }
                if code == Z_STREAM_END { return true }
                // no progress with room to write means the input ends too early
                if code != Z_OK || (stream.avail_in == 0 && stream.avail_out != 0) { return false }
            }
        }
        return ok ? output : nil
    }
}
