import XCTest
@testable import Kaivo

final class FeedTests: XCTestCase {
    private func parse(_ text: String, base: String = "https://example.com/feed") -> FeedParser.Parsed? {
        FeedParser.parse(Data(text.utf8), base: URL(string: base))
    }

    func testRSS() throws {
        let feed = try XCTUnwrap(parse("""
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>News &amp; more</title>
        <item><title>One&nbsp;two</title><link>/a</link><guid>g1</guid><pubDate>Tue, 24 Nov 2026 08:30:00 +0100</pubDate>
        <description>Short &lt;b&gt;teaser&lt;/b&gt;</description>
        <content:encoded><![CDATA[<p>First</p><script>alert(1)</script><p>Second &mdash; end</p>]]></content:encoded></item>
        <item><title>Tom & Jerry</title><link>https://example.com/b</link></item>
        </channel></rss>
        """))
        XCTAssertEqual(feed.title, "News & more")
        XCTAssertEqual(feed.items.count, 2)
        XCTAssertEqual(feed.items[0].title, "One two")
        XCTAssertEqual(feed.items[0].link, "https://example.com/a")
        XCTAssertEqual(feed.items[0].body, "First\n\nSecond — end")
        XCTAssertEqual(feed.items[0].summary, "Short teaser")
        XCTAssertNotNil(feed.items[0].published)
        XCTAssertEqual(feed.items[1].title, "Tom & Jerry")
    }

    func testAtomAndJSONFeed() throws {
        let atom = try XCTUnwrap(parse("""
        <feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><id>x</id><title>T</title>
        <link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/t"/>
        <updated>2026-11-24T10:00:00Z</updated><summary>S</summary><author><name>N</name></author></entry></feed>
        """))
        XCTAssertEqual(atom.items.first?.link, "https://example.com/t")
        XCTAssertEqual(atom.items.first?.author, "N")
        XCTAssertNotNil(atom.items.first?.published)
        let json = try XCTUnwrap(parse(#"{"version":"https://jsonfeed.org/version/1.1","title":"J","items":[{"id":"1","url":"/j","title":"Hi","content_html":"<p>Body</p>"}]}"#))
        XCTAssertEqual(json.items.first?.link, "https://example.com/j")
        XCTAssertEqual(json.items.first?.body, "Body")
    }

    func testRDF() throws {
        let rdf = try XCTUnwrap(parse("""
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
        <channel><title>R</title></channel><item><title>I</title><link>https://example.com/i</link></item></rdf:RDF>
        """))
        XCTAssertEqual(rdf.items.map(\.title), ["I"])
    }

    func testHostileAndBrokenInput() {
        // external entities are never resolved; the DOCTYPE is dropped
        let xxe = parse("""
        <?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>
        <rss><channel><title>T</title><item><title>&x;</title><link>https://example.com/a</link></item></channel></rss>
        """)
        XCTAssertFalse(xxe?.items.first?.title.contains("root:") ?? false)
        XCTAssertNil(parse("<html><body>no feed</body></html>"))
        XCTAssertNil(parse(""))
        let script = parse("<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>")
        XCTAssertEqual(script?.items.first?.link, "")
    }

    func testLatin1() throws {
        let bytes = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><rss><channel><title>Grüße</title></channel></rss>".data(using: .isoLatin1)!
        XCTAssertEqual(FeedParser.parse(bytes)?.title, "Grüße")
    }

    func testAddresses() {
        XCTAssertEqual(FeedFetcher.normalize("Example.com")?.absoluteString, "https://example.com/")
        XCTAssertEqual(FeedFetcher.normalize("http://example.com:443/a?b=1")?.absoluteString, "https://example.com/a?b=1")
        XCTAssertNil(FeedFetcher.normalize("ftp://example.com"))
        XCTAssertNil(FeedFetcher.normalize("not a url"))
        XCTAssertNil(FeedFetcher.normalize("https://user:pw@example.com"))
    }

    func testDiscovery() {
        let html = #"<head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head>"#
        XCTAssertEqual(FeedParser.discover(html, base: URL(string: "https://example.com/page")!).first?.absoluteString, "https://example.com/rss.xml")
    }

    func testDeepLinks() {
        let link = DeepLink.item(feed: "https://example.com/f?x=1&y=2", id: "a/b c")
        XCTAssertEqual(DeepLink(link.url), link)
        XCTAssertNil(DeepLink(URL(string: "https://example.com")!))
    }

    @MainActor
    func testSharedFolderAndLibrary() {
        XCTAssertTrue(SharedStore.isShared, "the App Group container is missing")
        XCTAssertEqual(Library.words(in: "one two three"), 3)
        XCTAssertEqual(Library.words(in: "睡眠让今天读到的内容"), 5)
    }

    func testPodcastSound() {
        let rss = """
        <rss version="2.0"><channel><title>Show</title>
        <item><guid>1</guid><title>Episode</title><enclosure url="https://x.test/a.mp3" type="audio/mpeg" length="1"/></item>
        <item><guid>2</guid><title>Picture</title><enclosure url="https://x.test/a.jpg" type="image/jpeg" length="1"/></item>
        <item><guid>3</guid><title>Insecure</title><enclosure url="http://x.test/a.mp3" type="audio/mpeg" length="1"/></item>
        </channel></rss>
        """
        let items = FeedParser.parse(Data(rss.utf8))?.items ?? []
        XCTAssertEqual(items.map(\.audio), ["https://x.test/a.mp3", nil, nil])
        let json = #"{"version":"https://jsonfeed.org/version/1.1","title":"S","items":[{"id":"1","title":"E","attachments":[{"url":"https://x.test/b.m4a","mime_type":"audio/mp4"}]}]}"#
        XCTAssertEqual(FeedParser.parse(Data(json.utf8), contentType: "application/feed+json")?.items.first?.audio, "https://x.test/b.m4a")
    }

    func testSampleStoriesAreComplete() {
        XCTAssertEqual(SampleData.stories.count, 5)
        XCTAssertTrue(SampleData.stories.allSatisfy { !$0.passages.isEmpty && $0.firstHighlight != nil })
    }
}
