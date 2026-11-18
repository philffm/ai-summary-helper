--[[--
One AISH article as an EPUB 3 file (with an EPUB 2 table of contents for older readers), so KOReader shows real book
information in its lists, the cover view and "Book information":

  title · author (the byline, else the site) · publisher (the site) · date saved · language · source (the URL)
  description = the AI summary as text · keywords = the AISH tags · series = the first AISH collection
  cover = the first image saved with the article · table of contents = Summary · the article's headings · Key points · Notes

The text is the same as the HTML version (render.lua), written as well-formed XHTML; images go inside the file.

@module aishlib.epub
]]
local render = require("aishlib.render")
local zip = require("aishlib.zip")
local crypto = require("aishlib.crypto")

local M = {}

local function x(s) return (tostring(s or ""):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")) end

-- named entities the browser writes (innerHTML) → numbers (XML knows only five by name)
local NAMED = { nbsp = 160, shy = 173, mdash = 8212, ndash = 8211, hellip = 8230, rsquo = 8217, lsquo = 8216, rdquo = 8221,
    ldquo = 8220, laquo = 171, raquo = 187, copy = 169, reg = 174, trade = 8482, euro = 8364, middot = 183, bull = 8226,
    times = 215, deg = 176, para = 182, sect = 167, zwnj = 8204, zwj = 8205, thinsp = 8201, ensp = 8194, emsp = 8195 }
local XMLOK = { amp = true, lt = true, gt = true, quot = true, apos = true }
local VOID = {}
for t in ("area base br col embed hr img input link meta source track wbr"):gmatch("%S+") do VOID[t] = true end

--- HTML as the browser serialises it → XHTML: void elements closed, entities XML can read, stray "&" escaped.
function M.xhtml(html)
    html = html:gsub("&(#?[%w]*);?", function(name)
        if name:match("^#x%x+$") or name:match("^#%d+$") then return "&" .. name .. ";" end
        if XMLOK[name] then return "&" .. name .. ";" end
        if NAMED[name] then return "&#" .. NAMED[name] .. ";" end
        return "&amp;" .. name
    end)
    -- a "&name" without ";" that is not an entity was already escaped above; void tags get their "/"
    html = html:gsub("<(%a[%w]*)([^>]*)>", function(tag, rest)
        if VOID[tag:lower()] and not rest:find("/%s*$") then return "<" .. tag .. rest .. "/>" end
        return nil
    end)
    return html
end

--- The summary as plain text, for the description.
local function plainText(html, max)
    local t = tostring(html or ""):gsub("<li[^>]*>", "\n• "):gsub("</p>", "\n"):gsub("<br%s*/?>", "\n"):gsub("<[^>]*>", "")
    t = t:gsub("&nbsp;", " "):gsub("&amp;", "&"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '"'):gsub("&#39;", "'")
    t = t:gsub("[ \t]+", " "):gsub("\n%s*\n+", "\n"):gsub("^%s+", ""):gsub("%s+$", "")
    if max and #t > max then
        t = t:sub(1, max)
        while #t > 0 and t:byte(#t) >= 0x80 and t:byte(#t) < 0xC0 do t = t:sub(1, -2) end
        if #t > 0 and t:byte(#t) >= 0xC0 then t = t:sub(1, -2) end
        t = t .. "…"
    end
    return t
end
M.plainText = plainText

local MIME = { jpg = "image/jpeg", png = "image/png", gif = "image/gif", webp = "image/webp", svg = "image/svg+xml" }
local EXT = { jpeg = "jpg", jpg = "jpg", png = "png", gif = "gif", webp = "webp", ["svg+xml"] = "svg" }

--[[--
a = article values · notes = notes on the article · labels (translated) ·
o = { id, keyPoints, tags = { … }, series, seriesIndex, imageMax, imagesMax, modified (seconds) }
→ EPUB bytes
]]
function M.build(a, notes, labels, o)
    o = o or {}
    local images, total = {}, 0
    local function image(mime, b64, n)
        local ext = EXT[mime]
        local size = math.floor(#b64 * 3 / 4)
        if not ext or size > (o.imageMax or math.huge) or total + size > (o.imagesMax or math.huge) then return nil end
        local bytes = crypto.fromB64Fast(b64)
        if not bytes then return nil end
        total = total + #bytes
        local name = "images/" .. n .. "." .. ext
        images[#images + 1] = { name = name, data = bytes, mime = MIME[ext], id = "img" .. n }
        return name
    end
    local html = render.article(a, nil, notes, labels, { keyPoints = o.keyPoints, image = image })
    local head = html:match("<head>(.-)</head>") or ""
    local body = html:match("<body>(.*)</body>") or ""
    local css = head:match("<style>(.-)</style>") or ""

    -- ids on the headings, and the table of contents from them (the title itself is not a chapter)
    local toc, n = {}, 0
    body = body:gsub("<(h[1-3])([^>]*)>(.-)</%1>", function(tag, attrs, inner)
        n = n + 1
        local id = attrs:match('%sid="([^"]*)"')
        if not id then id = "c" .. n; attrs = attrs .. ' id="' .. id .. '"' end
        if not attrs:find("aish%-title") then
            local text = plainText(inner):gsub("\n", " ")
            if text ~= "" then toc[#toc + 1] = { level = tonumber(tag:sub(2)), id = id, text = text } end
        end
        return "<" .. tag .. attrs .. ">" .. inner .. "</" .. tag .. ">"
    end)
    local title = a.title and a.title ~= "" and a.title or (tostring(a.url or ""):match("^%a+://([^/]+)") or "Article")
    local lang = (a.language or a.lang or "en"):match("^[%a][%a%-]*") or "en"
    local site = tostring(a.url or ""):match("^%a+://([^/]+)") or ""
    local author = a.byline or a.author or (type(a.meta) == "table" and a.meta.author) or site
    local uid = "urn:aish:article:" .. tostring(o.id or title)
    local modified = os.date("!%Y-%m-%dT%H:%M:%SZ", o.modified or os.time())

    local xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
        .. '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' .. x(lang) .. '" lang="' .. x(lang) .. '">'
        .. '<head><meta charset="utf-8"/><title>' .. x(title) .. '</title><link rel="stylesheet" type="text/css" href="style.css"/></head>'
        .. "<body>" .. M.xhtml(body) .. "</body></html>\n"

    -- table of contents: EPUB 3 nav and EPUB 2 NCX
    local nav, ncx = {}, {}
    for i, t in ipairs(toc) do
        nav[#nav + 1] = '<li><a href="article.xhtml#' .. x(t.id) .. '">' .. x(t.text) .. "</a></li>"
        ncx[#ncx + 1] = '<navPoint id="n' .. i .. '" playOrder="' .. i .. '"><navLabel><text>' .. x(t.text) .. '</text></navLabel><content src="article.xhtml#' .. x(t.id) .. '"/></navPoint>'
    end
    if #toc == 0 then
        nav[1] = '<li><a href="article.xhtml">' .. x(title) .. "</a></li>"
        ncx[1] = '<navPoint id="n1" playOrder="1"><navLabel><text>' .. x(title) .. '</text></navLabel><content src="article.xhtml"/></navPoint>'
    end
    local navDoc = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>'
        .. x(title) .. '</title></head><body><nav epub:type="toc" id="toc"><ol>' .. table.concat(nav) .. "</ol></nav></body></html>\n"
    local ncxDoc = '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="'
        .. x(uid) .. '"/></head><docTitle><text>' .. x(title) .. "</text></docTitle><navMap>" .. table.concat(ncx) .. "</navMap></ncx>\n"

    -- book information
    local meta = {
        '<dc:identifier id="uid">' .. x(uid) .. "</dc:identifier>",
        "<dc:title>" .. x(title) .. "</dc:title>",
        "<dc:language>" .. x(lang) .. "</dc:language>",
        '<meta property="dcterms:modified">' .. modified .. "</meta>",
    }
    if author ~= "" then meta[#meta + 1] = "<dc:creator>" .. x(author) .. "</dc:creator>" end
    if site ~= "" then meta[#meta + 1] = "<dc:publisher>" .. x(site) .. "</dc:publisher>" end
    if a.url then meta[#meta + 1] = "<dc:source>" .. x(a.url) .. "</dc:source>" end
    local date = tostring(a.timestamp or ""):match("^%d%d%d%d%-%d%d%-%d%d")
    if date then meta[#meta + 1] = "<dc:date>" .. date .. "</dc:date>" end
    local desc = plainText(a.summaryBase or a.summary, 2000)
    if desc ~= "" then meta[#meta + 1] = "<dc:description>" .. x(desc) .. "</dc:description>" end
    for _, tg in ipairs(o.tags or {}) do meta[#meta + 1] = "<dc:subject>" .. x(tg) .. "</dc:subject>" end
    if o.series and o.series ~= "" then
        meta[#meta + 1] = '<meta name="calibre:series" content="' .. x(o.series) .. '"/>'
        meta[#meta + 1] = '<meta name="calibre:series_index" content="' .. tostring(o.seriesIndex or 1) .. '"/>'
        meta[#meta + 1] = '<meta property="belongs-to-collection" id="series">' .. x(o.series) .. "</meta>"
        meta[#meta + 1] = '<meta refines="#series" property="collection-type">series</meta>'
        meta[#meta + 1] = '<meta refines="#series" property="group-position">' .. tostring(o.seriesIndex or 1) .. "</meta>"
    end
    local manifest = {
        '<item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>',
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    }
    for i, img in ipairs(images) do
        manifest[#manifest + 1] = '<item id="' .. img.id .. '" href="' .. img.name .. '" media-type="' .. img.mime .. '"' .. (i == 1 and ' properties="cover-image"' or "") .. "/>"
    end
    if images[1] then meta[#meta + 1] = '<meta name="cover" content="' .. images[1].id .. '"/>' end
    local opf = '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="' .. x(lang) .. '">'
        .. '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' .. table.concat(meta) .. "</metadata>"
        .. "<manifest>" .. table.concat(manifest) .. "</manifest>"
        .. '<spine toc="ncx"><itemref idref="article"/></spine></package>\n'

    local entries = {
        { name = "mimetype", data = "application/epub+zip", store = true },
        { name = "META-INF/container.xml", data = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n' },
        { name = "OEBPS/content.opf", data = opf },
        { name = "OEBPS/nav.xhtml", data = navDoc },
        { name = "OEBPS/toc.ncx", data = ncxDoc },
        { name = "OEBPS/style.css", data = css },
        { name = "OEBPS/article.xhtml", data = xhtml },
    }
    for _, img in ipairs(images) do
        -- images are compressed already: stored
        entries[#entries + 1] = { name = "OEBPS/" .. img.name, data = img.data, store = true }
    end
    return zip.build(entries, o.modified), #images
end

return M
