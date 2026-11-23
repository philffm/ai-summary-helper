--[[--
One Kaivo article as an HTML file for KOReader: title, source, the AI summary, the article's full text with your highlights
(AI highlights underlined), notes on highlights as footnotes (a tap shows them in a popup), and your notes on the article.

@module aishlib.render
]]

local M = {}

local function esc(s)
    return (tostring(s or ""):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
end
M.esc = esc

--- Saved HTML is someone else's page: only what an e-reader shows is kept (no scripts, frames, forms, remote images,
--- event handlers or javascript: links). KOReader runs no scripts, but the file should still be clean.
-- tags dropped with everything inside them; tags dropped alone (their content stays)
local DROP = {}
for t in ("script style iframe object embed noscript template form svg math video audio canvas button select textarea head"):gmatch("%S+") do DROP[t] = true end
local STRIP = {}
for t in ("html body link meta base input picture source"):gmatch("%S+") do STRIP[t] = true end

local function cleanAttrs(tag)
    -- only tags that carry something to remove pay for the patterns
    local low = tag:lower()
    if not (low:find("%son%a+%s*=") or low:find("style", 1, true) or low:find("javascript:", 1, true) or low:find("data:", 1, true)) then return tag end
    local open, attrs, close = tag:match("^(<%a[%w]*)(.-)(/?>)$")
    if not open then return tag end
    attrs = attrs:gsub('%s[oO][nN]%w+%s*=%s*"[^"]*"', ""):gsub("%s[oO][nN]%w+%s*=%s*'[^']*'", ""):gsub("%s[oO][nN]%w+%s*=%s*[^%s>]+", "")
    attrs = attrs:gsub('%s[sS][tT][yY][lL][eE]%s*=%s*"[^"]*"', ""):gsub("%s[sS][tT][yY][lL][eE]%s*=%s*'[^']*'", "")
    attrs = attrs:gsub('(%s[hH][rR][eE][fF]%s*=%s*")([^"]*)(")', function(x, url, y)
        local u = url:lower()
        if u:match("^%s*javascript:") or u:match("^%s*data:") then return "" end
        return x .. url .. y
    end)
    return open .. attrs .. close
end

--- Saved HTML is someone else's page: only what an e-reader shows is kept (no scripts, frames, forms, remote images,
--- event handlers or javascript: links). One pass over the tags: a long article takes a few milliseconds.
function M.clean(html, image)
    html = tostring(html or "")
    local nImg = 0
    local low = html:lower()
    local out, n, pos, len = {}, 0, 1, #html
    while pos <= len do
        local lt = html:find("<", pos, true)
        if not lt then n = n + 1; out[n] = html:sub(pos); break end
        if lt > pos then n = n + 1; out[n] = html:sub(pos, lt - 1) end
        if html:sub(lt, lt + 3) == "<!--" then
            local e = html:find("-->", lt + 4, true)
            pos = e and e + 3 or len + 1
        else
            local gt = html:find(">", lt + 1, true) or len
            local tag = html:sub(lt, gt)
            local closing, name = low:match("^<(/?)([%a][%w]*)", lt)
            if not name then   -- a "<" that starts no tag: kept as text
                n = n + 1; out[n] = "&lt;"; pos = lt + 1
            elseif DROP[name] then
                if closing == "" and not tag:find("/>$") then
                    local e = low:find("</" .. name .. "%s*>", gt + 1)
                    if e then pos = (low:find(">", e, true) or len) + 1 else pos = gt + 1 end
                else pos = gt + 1 end
            elseif STRIP[name] then pos = gt + 1
            elseif name == "img" then
                -- images the extension saved inside the article (base64) become files next to it; remote ones cannot be
                -- fetched by the reader: their description stays
                local alt = tag:match('%s[aA][lL][tT]="([^"]*)"') or tag:match("%s[aA][lL][tT]='([^']*)'")
                local mime, b64 = tag:match('%s[sS][rR][cC]%s*=%s*["\']data:image/([%w%.%+%-]+);base64,([A-Za-z0-9+/=%s]+)["\']')
                local src
                if mime and image then nImg = nImg + 1; src = image(mime:lower(), b64, nImg, alt) end
                if src then
                    n = n + 1; out[n] = '<img src="' .. src .. '"' .. (alt and (' alt="' .. alt:gsub('"', "&quot;") .. '"') or "") .. "/>"
                elseif alt and alt ~= "" then n = n + 1; out[n] = '<span class="aish-img">[' .. alt .. "]</span>" end
                pos = gt + 1
            else
                n = n + 1; out[n] = closing == "" and cleanAttrs(tag) or tag
                pos = gt + 1
            end
        end
    end
    return table.concat(out)
end

local CSS = [[
body { line-height: 1.45; }
h1.aish-title { font-size: 1.5em; margin: 0 0 .3em; }
p.aish-meta { font-size: .85em; color: #555; margin: 0 0 1em; }
section.aish-summary { border-left: 3px solid #999; padding-left: .8em; margin: 0 0 1.4em; }
section.aish-summary h2, section.aish-notes h2 { font-size: 1.05em; margin: 0 0 .4em; }
mark { background-color: #d6d6d6; color: inherit; }
mark.ai { background-color: transparent; text-decoration: underline; }
sup a.aish-ref { text-decoration: none; font-weight: bold; }
section.aish-notes { border-top: 1px solid #999; margin-top: 2em; padding-top: .6em; font-size: .92em; }
div.aish-note { margin: 0 0 .8em; }
div.aish-note blockquote { margin: 0 0 .2em 0; font-style: italic; }
p.aish-empty { font-style: italic; color: #555; }
span.aish-img { color: #777; font-size: .85em; }
img { max-width: 100%; }
section.aish-keypoints h2 { font-size: 1.05em; margin: 1.6em 0 .4em; }
]]

local function dateOf(ts)
    local y, mo, d = tostring(ts or ""):match("^(%d%d%d%d)%-(%d%d)%-(%d%d)")
    return y and (y .. "-" .. mo .. "-" .. d) or ""
end
local function host(url) return tostring(url or ""):match("^%a+://([^/]+)") or "" end

--- Plain text of a note, as paragraphs.
local function paras(text)
    local out = {}
    for p in (tostring(text or "") .. "\n\n"):gmatch("(.-)\n%s*\n") do
        if p:match("%S") then out[#out + 1] = "<p>" .. esc(p):gsub("\n", "<br/>") .. "</p>" end
    end
    return table.concat(out)
end

--[[--
a = article values { title, url, timestamp, summaryBase|summary, content, byline|author, language|lang, tags? }
hls = { { id, text, type, quote = { exact, prefix, suffix }, dismissed } }
notes = { { id, kind, text, highlightId, quote } }   (comments on highlights and notes on the article)
labels = { summary, notes, noText, highlight, aiHighlight }   (translated)
]]
--[[--
a = article values { title, url, timestamp, summaryBase|summary, content, byline|author, language|lang }
notes = your notes on the article { id, text, quote }
labels = { summary, keyPoints, notes, noText }   (translated)
opts = { keyPoints = { "sentence", … } (the AI highlights), image = function(mime, base64, n) → src or nil }

The chapters (KOReader's table of contents): Summary · the article's own headings · Key points · Notes. The sections keep
their order and are always there (empty when there is nothing): KOReader's highlights point into the article section by
its position, so a summary that appears later must not move it.
]]
function M.article(a, _, notes, labels, opts)
    labels, opts = labels or {}, opts or {}
    local title = a.title and a.title ~= "" and a.title or host(a.url)
    local articleNotes = {}
    for _, n in ipairs(notes or {}) do
        if not (n.highlightId and n.highlightId ~= "") and n.text and n.text:match("%S") then articleNotes[#articleNotes + 1] = n end
    end
    local body = M.clean(a.content, opts.image)
    local hasText = body:match("^%s*[^<%s]") ~= nil or body:find(">[^<]*[^<%s]") ~= nil

    local out = {}
    local function w(s) out[#out + 1] = s end
    w('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n')
    w('<html xmlns="http://www.w3.org/1999/xhtml"' .. ((a.language or a.lang) and (' lang="' .. esc(a.language or a.lang) .. '"') or "") .. ">")
    w('<head><meta charset="utf-8"/><title>' .. esc(title) .. "</title>")
    local author = a.byline or a.author or (type(a.meta) == "table" and a.meta.author) or host(a.url)
    if author and author ~= "" then w('<meta name="author" content="' .. esc(author) .. '"/>') end
    w("<style>" .. CSS .. "</style></head><body>")
    w('<h1 class="aish-title">' .. esc(title) .. "</h1>")
    local meta = {}
    if host(a.url) ~= "" then meta[#meta + 1] = '<a href="' .. esc(a.url) .. '">' .. esc(host(a.url)) .. "</a>" end
    if dateOf(a.timestamp) ~= "" then meta[#meta + 1] = dateOf(a.timestamp) end
    if a.byline and a.byline ~= "" then meta[#meta + 1] = esc(a.byline) end
    w('<p class="aish-meta">' .. table.concat(meta, " · ") .. "</p>")
    local summary = a.summaryBase or a.summary
    if summary and tostring(summary):match("%S") then
        w('<section class="aish-summary"><h2>' .. esc(labels.summary or "Summary") .. "</h2>" .. M.clean(summary) .. "</section>")
    else w('<section class="aish-summary"></section>') end
    if hasText then w('<section class="aish-article">' .. body .. "</section>")
    else w('<section class="aish-article"><p class="aish-empty">' .. esc(labels.noText or "The full text of this article was not saved.") .. "</p></section>") end
    local kp = opts.keyPoints or {}
    if #kp > 0 then
        w('<section class="aish-keypoints"><h2>' .. esc(labels.keyPoints or "Key points") .. "</h2><ul>")
        for _, t in ipairs(kp) do w("<li>" .. esc(t) .. "</li>") end
        w("</ul></section>")
    else w('<section class="aish-keypoints"></section>') end
    if #articleNotes > 0 then
        w('<section class="aish-notes"><h2>' .. esc(labels.notes or "Notes") .. "</h2>")
        for _, n in ipairs(articleNotes) do
            w('<div class="aish-note">' .. (n.quote and n.quote ~= "" and ("<blockquote>" .. esc(n.quote) .. "</blockquote>") or "") .. paras(n.text) .. "</div>")
        end
        w("</section>")
    end
    w("</body></html>\n")
    return table.concat(out)
end

--- A file name for the article: its title, made safe for FAT/exFAT e-reader storage, plus a short id so two articles
--- with one title never share a file.
function M.fileName(title, id, ext)
    local t = tostring(title or ""):gsub('[%c/\\:%*%?"<>|]', " "):gsub("%s+", " "):gsub("^[%s%.]+", ""):gsub("[%s%.]+$", "")
    if #t > 90 then
        t = t:sub(1, 90)
        while #t > 0 and t:byte(#t) >= 0x80 and t:byte(#t) < 0xC0 do t = t:sub(1, -2) end   -- no cut UTF-8 character
        if #t > 0 and t:byte(#t) >= 0xC0 then t = t:sub(1, -2) end
        t = t:gsub("%s+$", "")
    end
    if t == "" then t = "Article" end
    local short = tostring(id or ""):gsub("[^%w]", ""):sub(-6)
    return t .. (short ~= "" and (" [" .. short .. "]") or "") .. "." .. (ext or "html")
end

return M
