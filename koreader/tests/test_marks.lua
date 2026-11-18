-- Highlights are found in the article HTML across tags, entities and line breaks, and wrapped without breaking the markup.
local M = require("aishlib.marks")
local html = [[<p>Sleep is <em>not</em> a pause.</p><p>During slow-wave sleep, the brain replays the day&#8217;s experiences.</p>
<p>Short naps help.</p><p>Short naps help, the study says.</p><script>var x = "Sleep is not";</script>]]
local out, found = M.apply(html, {
    { exact = "Sleep is not a pause", class = "u" },
    { exact = "the brain replays the day's experiences", class = "u", ref = "n1" },
    { exact = "Short naps help", prefix = "naps help. ", suffix = ", the study", class = "ai" },
    { exact = "nowhere in this text" },
})
assert(#found == 3, "three of four found: " .. #found)
assert(out:find('<p><mark class="u">Sleep is </mark><em><mark class="u">not</mark></em><mark class="u"> a pause</mark>.</p>', 1, true), "across a tag: " .. out)
assert(out:find('<mark class="u">the brain replays the day&#8217;s experiences</mark><sup><a class="aish-ref" href="#n1">*</a></sup>', 1, true), "entity kept, footnote link: " .. out)
-- the context picks the second "Short naps help"
assert(out:find('<p>Short naps help.</p><p><mark class="ai">Short naps help</mark>, the study says.</p>', 1, true), "context chooses: " .. out)
assert(out:find('var x = "Sleep is not";', 1, true) and not out:find("<script><mark", 1, true), "scripts untouched")
-- removing the marks gives back the original
local stripped = out:gsub('<mark[^>]*>', ''):gsub('</mark>', ''):gsub('<sup><a class="aish%-ref"[^>]*>%*</a></sup>', '')
assert(stripped == html, "only marks were added")
-- line breaks and spaces inside the quote; quote across two paragraphs
out = M.apply("<p>one two\n   three</p><p>four five</p>", { { exact = "two three four" } })
assert(out == "<p>one <mark>two\n   three</mark></p><p><mark>four</mark> five</p>", out)
-- nbsp and typographic quotes in the text match plain ones in the quote
out, found = M.apply("<p>He said &ldquo;yes&rdquo;&nbsp;today</p>", { { exact = '"yes" today' } })
assert(#found == 1, out)
-- multi-byte characters are never split
out = M.apply("<p>Grüße aus Köln</p>", { { exact = "Grüße aus" } })
assert(out == "<p><mark>Grüße aus</mark> Köln</p>", out)
