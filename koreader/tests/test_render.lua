-- An article as KOReader's HTML: chapters (Summary · text · Key points · Notes), cleaned text, images saved inside the
-- article become files, sections that never move; safe file names.
local R = require("aishlib.render")
local png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
local a = { title = "Sleep & learning <study>", url = "https://news.example/sleep?id=1", timestamp = "2026-11-02T10:00:00.000Z", language = "en",
  summaryBase = "<ul><li>Sleep consolidates memory.</li></ul>",
  content = '<html><body><h2>Part one</h2><p onclick="x()" style="color:red">Sleep is not a pause.</p><script>alert(1)</script><p>Naps help <a href="javascript:evil()">here</a> and <a href="https://ok.example/">there</a>.</p><img src="data:image/png;base64,' .. png .. '" alt="A chart"><img src="https://img/x.png" alt="Remote"><iframe src="https://e"></iframe><SCRIPT>bad()</SCRIPT></body></html>' }
local images = {}
local html = R.article(a, nil, { { id = "n1", kind = "note", text = "Read again before the exam." } },
  { summary = "Zusammenfassung", keyPoints = "Kernpunkte", notes = "Notizen" },
  { keyPoints = { "Short naps help.", "Sleep is not a pause." }, image = function(mime, b64, n) images[#images + 1] = { mime, b64, n }; return ".images/a-" .. n .. ".png" end })
assert(html:find("<title>Sleep &amp; learning &lt;study&gt;</title>", 1, true), "title escaped")
assert(not html:find("onclick", 1, true) and not html:find("color:red", 1, true) and not html:find("alert", 1, true) and not html:find("bad()", 1, true), "handlers, styles and scripts removed")
assert(not html:find("javascript:", 1, true) and html:find('href="https://ok.example/"', 1, true), "only web links kept")
assert(not html:find("<iframe", 1, true) and not html:find("<mark", 1, true), "no frames, no marks (highlights are KOReader's own)")
assert(#images == 1 and images[1][1] == "png" and images[1][2] == png and html:find('<img src=".images/a-1.png" alt="A chart"/>', 1, true), "saved image → file")
assert(html:find("[Remote]", 1, true) and not html:find("https://img/x.png", 1, true), "remote image: its description")
-- chapters in order
local s1 = html:find("<h2>Zusammenfassung</h2>", 1, true); local s2 = html:find("<h2>Part one</h2>", 1, true)
local s3 = html:find("<h2>Kernpunkte</h2>", 1, true); local s4 = html:find("<h2>Notizen</h2>", 1, true)
assert(s1 and s2 and s3 and s4 and s1 < s2 and s2 < s3 and s3 < s4, "Summary · text · Key points · Notes")
assert(html:find("<li>Short naps help.</li>", 1, true) and html:find("Read again before the exam.", 1, true))
assert(html:find('<meta name="author" content="news.example"/>', 1, true), "author falls back to the site")
-- the sections are always there, in the same order: a summary added later does not move the text
local function sections(h) local out = {}; for c in h:gmatch('<section class="(aish%-[%w]+)"') do out[#out + 1] = c end return table.concat(out, ",") end
local h2 = R.article({ title = "Only text", url = "https://x.example/", content = "<p>Text.</p>" }, nil, {}, {})
local h3 = R.article({ title = "Only text", url = "https://x.example/", content = "<p>Text.</p>", summaryBase = "<p>Now a summary.</p>" }, nil, {}, {})
assert(sections(h2) == "aish-summary,aish-article,aish-keypoints" and sections(h3) == sections(h2), sections(h2) .. " / " .. sections(h3))
local h4 = R.article({ title = "Only summary", url = "https://x.example/", summaryBase = "<p>Short.</p>" }, nil, {}, {})
assert(h4:find("was not saved", 1, true))
-- file names
assert(R.fileName('A/B: "C"?', "1731000000000-abc123") == "A B C [abc123].html")
local long = R.fileName(string.rep("ü", 80), "x1")
assert(#long < 110 and long:find(" %[x1%]%.html$"), long)
assert(R.fileName("", "id") == "Article [id].html")
