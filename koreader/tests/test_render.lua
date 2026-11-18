-- An article as KOReader's HTML: summary, cleaned full text with marks, notes as footnotes; safe file names.
local R = require("aishlib.render")
local a = { title = "Sleep & learning <study>", url = "https://news.example/sleep?id=1", timestamp = "2026-11-02T10:00:00.000Z", language = "en",
  summaryBase = "<ul><li>Sleep consolidates memory.</li></ul>",
  content = '<html><body><p onclick="x()" style="color:red">Sleep is not a pause.</p><script>alert(1)</script><p>Naps help <a href="javascript:evil()">here</a> and <a href="https://ok.example/">there</a>.</p><img src="https://img/x.png" alt="A chart"><iframe src="https://e"></iframe><SCRIPT>bad()</SCRIPT></body></html>' }
local html = R.article(a, {
    { id = "h1", text = "Sleep is not a pause.", type = "user", quote = { exact = "Sleep is not a pause." } },
    { id = "h2", text = "Naps help", type = "ghost" },
    { id = "h3", text = "dismissed one", type = "ghost", dismissed = true },
  }, {
    { id = "c_h1", kind = "comment", highlightId = "h1", text = "Matches what Walker writes.\n\nCheck chapter 3." },
    { id = "n1", kind = "note", text = "Read again before the exam." },
  }, { summary = "Zusammenfassung", notes = "Notizen" })
assert(html:find("<title>Sleep &amp; learning &lt;study&gt;</title>", 1, true), "title escaped")
assert(html:find("Zusammenfassung", 1, true) and html:find("<li>Sleep consolidates memory.</li>", 1, true), "summary")
assert(not html:find("onclick", 1, true) and not html:find("color:red", 1, true) and not html:find("alert", 1, true) and not html:find("bad()", 1, true), "handlers, styles and scripts removed")
assert(not html:find("javascript:", 1, true) and html:find('href="https://ok.example/"', 1, true), "only web links kept")
assert(not html:find("<iframe", 1, true) and not html:find("<img", 1, true) and html:find("[A chart]", 1, true), "frames and images go, alt text stays")
assert(html:find('<mark>Sleep is not a pause.</mark><sup><a class="aish-ref" href="#aish-n1">1</a></sup>', 1, true), "your highlight + footnote: " .. html)
assert(html:find('<mark class="ai">Naps help</mark>', 1, true), "AI highlight underlined")
assert(html:find('id="aish-n1"', 1, true) and html:find("<p>Matches what Walker writes.</p><p>Check chapter 3.</p>", 1, true), "comment as footnote")
assert(html:find("Read again before the exam.", 1, true) and html:find("Notizen", 1, true), "article note")
assert(html:find('<meta name="author" content="news.example"/>', 1, true), "author falls back to the site")
-- no full text
local h2 = R.article({ title = "Only summary", url = "https://x.example/", summaryBase = "<p>Short.</p>" }, {}, {}, {})
assert(h2:find("was not saved", 1, true) and not h2:find("<section class=\"aish-notes\"", 1, true))
-- file names
assert(R.fileName('A/B: "C"?', "1731000000000-abc123") == "A B C [abc123].html", R.fileName('A/B: "C"?', "1731000000000-abc123"))
local long = R.fileName(string.rep("ü", 80), "x1")
assert(#long < 110 and long:find(" %[x1%]%.html$"), long)
assert(R.fileName("", "id") == "Article [id].html")
