--[[--
One AISH article as an HTML file for KOReader: title, source, the AI summary, the article's full text with your highlights
(AI highlights underlined), notes on highlights as footnotes (a tap shows them in a popup), and your notes on the article.

@module aishlib.render
]]
local marks = require("aishlib.marks")

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
function M.clean(html)
    html = tostring(html or "")
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
            elseif name == "img" then   -- the reader cannot fetch images; their description stays
                local alt = tag:match('%s[aA][lL][tT]="([^"]*)"') or tag:match("%s[aA][lL][tT]='([^']*)'")
                if alt and alt ~= "" then n = n + 1; out[n] = '<span class="aish-img">[' .. alt .. "]</span>" end
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
function M.article(a, hls, notes, labels)
    labels = labels or {}
    local title = a.title and a.title ~= "" and a.title or host(a.url)
    local commentsByHl, articleNotes = {}, {}
    for _, n in ipairs(notes or {}) do
        if n.highlightId and n.highlightId ~= "" then
            commentsByHl[n.highlightId] = commentsByHl[n.highlightId] or {}
            table.insert(commentsByHl[n.highlightId], n)
        elseif n.text and n.text:match("%S") then articleNotes[#articleNotes + 1] = n end
    end

    -- marks: your highlights, then AI ones; a highlight with a comment links to it
    local list, refs = {}, {}
    for _, h in ipairs(hls or {}) do
        if not h.dismissed then
            local q = h.quote or {}
            local m = { exact = q.exact or h.text, prefix = q.prefix, suffix = q.suffix, class = h.type == "ghost" and "ai" or nil, hl = h }
            if h.id and commentsByHl[h.id] then
                refs[#refs + 1] = h
                m.ref = "aish-n" .. #refs; m.refLabel = tostring(#refs)
            end
            list[#list + 1] = m
        end
    end
    table.sort(list, function(x, y) return (x.class or "") < (y.class or "") end)   -- yours first: they win where both overlap

    local body = M.clean(a.content)
    local hasText = body:match("^%s*[^<%s]") ~= nil or body:find(">[^<]*[^<%s]") ~= nil
    if hasText and #list > 0 then body = marks.apply(body, list) end

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
    end
    if hasText then w('<section class="aish-article">' .. body .. "</section>")
    else w('<p class="aish-empty">' .. esc(labels.noText or "The full text of this article was not saved.") .. "</p>") end

    if #refs > 0 or #articleNotes > 0 then
        w('<section class="aish-notes"><h2>' .. esc(labels.notes or "Notes") .. "</h2>")
        for i, h in ipairs(refs) do
            w('<div class="aish-note" id="aish-n' .. i .. '"><blockquote><b>' .. i .. ".</b> " .. esc((h.quote and h.quote.exact) or h.text) .. "</blockquote>")
            for _, n in ipairs(commentsByHl[h.id]) do w(paras(n.text)) end
            w("</div>")
        end
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
function M.fileName(title, id)
    local t = tostring(title or ""):gsub('[%c/\\:%*%?"<>|]', " "):gsub("%s+", " "):gsub("^[%s%.]+", ""):gsub("[%s%.]+$", "")
    if #t > 90 then
        t = t:sub(1, 90)
        while #t > 0 and t:byte(#t) >= 0x80 and t:byte(#t) < 0xC0 do t = t:sub(1, -2) end   -- no cut UTF-8 character
        if #t > 0 and t:byte(#t) >= 0xC0 then t = t:sub(1, -2) end
        t = t:gsub("%s+$", "")
    end
    if t == "" then t = "Article" end
    local short = tostring(id or ""):gsub("[^%w]", ""):sub(-6)
    return t .. (short ~= "" and (" [" .. short .. "]") or "") .. ".html"
end

return M
