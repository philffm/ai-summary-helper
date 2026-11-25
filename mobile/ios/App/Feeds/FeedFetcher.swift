import Foundation

/// Downloads feeds: https only (iOS blocks plain http, and the app asks for no exception), at most 3 MB, with validators so
/// an unchanged feed costs almost nothing.
enum FeedFetcher {
    static let maxBytes = 3_000_000

    enum Failure: Error { case address, insecure, unreachable, tooLarge, notAFeed }

    struct Result {
        var url: URL
        var parsed: FeedParser.Parsed?   // nil: unchanged since the last download
        var etag = ""
        var modified = ""
    }

    /// "example.com/feed" → https://example.com/feed. An http address is tried as https.
    static func normalize(_ input: String) -> URL? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty || s.contains(" ") { return nil }
        if s.lowercased().hasPrefix("feed://") { s = "https://" + s.dropFirst(7) }
        if s.lowercased().hasPrefix("http://") { s = "https://" + s.dropFirst(7) }
        if !s.contains("://") { s = "https://" + s }
        guard var c = URLComponents(string: s), c.scheme?.lowercased() == "https", let host = c.host, host.contains("."), c.user == nil else { return nil }
        c.scheme = "https"
        c.host = host.lowercased()
        if c.port == 443 { c.port = nil }
        if c.path.isEmpty { c.path = "/" }
        return c.url
    }

    /// Fetches a feed. When `discovering`, a web page is searched for the feed it announces.
    static func fetch(_ url: URL, etag: String = "", modified: String = "", discovering: Bool = false) async throws -> Result {
        guard url.scheme == "https" else { throw Failure.insecure }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5", forHTTPHeaderField: "Accept")
        if !etag.isEmpty { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        if !modified.isEmpty { request.setValue(modified, forHTTPHeaderField: "If-Modified-Since") }

        let data: Data
        let response: URLResponse
        do {
            let (bytes, r) = try await URLSession.shared.bytes(for: request)
            response = r
            if r.expectedContentLength > Int64(maxBytes) { throw Failure.tooLarge }
            var buffer = Data()
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count > maxBytes { throw Failure.tooLarge }
            }
            data = buffer
        } catch let failure as Failure {
            throw failure
        } catch let error as URLError where error.code == .appTransportSecurityRequiresSecureConnection {
            throw Failure.insecure
        } catch {
            throw Failure.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.unreachable }
        let final = http.url ?? url
        if http.statusCode == 304 { return Result(url: final, parsed: nil, etag: etag, modified: modified) }
        guard (200..<300).contains(http.statusCode) else { throw Failure.unreachable }
        let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
        if let parsed = FeedParser.parse(data, contentType: type, base: final) {
            return Result(url: final, parsed: parsed, etag: http.value(forHTTPHeaderField: "ETag") ?? "",
                          modified: http.value(forHTTPHeaderField: "Last-Modified") ?? "")
        }
        if discovering, let found = FeedParser.discover(FeedParser.decode(data, contentType: type), base: final).first {
            return try await fetch(found)
        }
        throw Failure.notAFeed
    }
}
