-- EPUB output: a valid ZIP (mimetype first, stored), well-formed XHTML from browser-serialised HTML, book information.
local E, Z = require("aishlib.epub"), require("aishlib.zip")
assert(E.xhtml("<p>a&nbsp;b<br>c &copy; AT&T &amp; &lt;x&gt; &#160; &#x2014;<img src=\"x\" alt=\"y\"><hr></p>") ==
    '<p>a&#160;b<br/>c &#169; AT&amp;T &amp; &lt;x&gt; &#160; &#x2014;<img src="x" alt="y"/><hr/></p>', "XHTML")
assert(Z.crc32("hello") == 0x3610a686, "CRC-32")
local bytes = E.build({ title = "T & U", url = "https://site.example/p", timestamp = "2026-11-02T08:00:00.000Z", summaryBase = "<p>Gist.</p>", content = "<h2>One</h2><p>x</p>" },
    {}, {}, { id = "a1", tags = { "ai" }, series = "S", seriesIndex = 3, modified = 1793606400 })
assert(bytes:sub(1, 4) == "PK\3\4" and bytes:sub(31, 38) == "mimetype" and bytes:sub(39, 58) == "application/epub+zip", "mimetype first, stored")
local dir = os.tmpname(); os.remove(dir); os.execute("mkdir -p " .. dir)
local f = io.open(dir .. "/t.epub", "wb"); f:write(bytes); f:close()
local function member(m) local h = io.popen("unzip -p " .. dir .. "/t.epub " .. m); local t = h:read("*a"); h:close(); return t end
local opf = member("OEBPS/content.opf")
assert(opf:find("<dc:title>T &amp; U</dc:title>") and opf:find("<dc:subject>ai</dc:subject>") and opf:find('content="S"') and opf:find('"calibre:series_index" content="3"'))
assert(opf:find("<dc:description>Gist.</dc:description>") and opf:find("<dc:creator>site.example</dc:creator>"))
assert(member("OEBPS/nav.xhtml"):find('href="article.xhtml#c%d">One</a>'), "chapter in the table of contents")
os.execute("rm -rf " .. dir)
