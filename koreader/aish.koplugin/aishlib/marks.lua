--[[--
Highlights drawn into the article's HTML: each saved quote is found in the text (across tags, entities and line breaks)
and wrapped in <mark>. Where a quote occurs more than once, the words saved before and after it pick the occurrence.

Read-only stage: the marks are part of the file KOReader opens, so they need nothing from KOReader's own annotations.

@module aishlib.marks
]]
local M = {}

local ENT = { amp = "&", lt = "<", gt = ">", quot = '"', apos = "'", nbsp = " ", shy = "", mdash = "—", ndash = "–",
    hellip = "…", rsquo = "’", lsquo = "‘", rdquo = "”", ldquo = "“", laquo = "«", raquo = "»" }

local function utf8char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40) end
    if cp < 0x10000 then return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40) end
    return string.char(0xF0 + math.floor(cp / 0x40000), 0x80 + math.floor(cp / 0x1000) % 0x40, 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end
local function decodeEntity(e)
    local n = e:match("^#[xX](%x+)$")
    if n then return utf8char(tonumber(n, 16)) end
    n = e:match("^#(%d+)$")
    if n then return utf8char(tonumber(n)) end
    return ENT[e]
end
M.decodeEntity = decodeEntity

local BLOCK = {}
for t in ("p div li ul ol h1 h2 h3 h4 h5 h6 br hr blockquote pre tr td th table section article header footer figure figcaption dd dt dl aside main nav"):gmatch("%S+") do BLOCK[t] = true end

--- Normalized text for matching: whitespace runs → one space, trimmed; typographic quotes and apostrophes → plain ones.
-- (UTF-8 sequences one by one: a Lua character class would work on single bytes)
local function plainQuotes(s)
    return (s:gsub("’", "'"):gsub("‘", "'"):gsub("“", '"'):gsub("”", '"'):gsub("\194\160", " "))
end
local function norm(s)
    s = plainQuotes(s)
    return (s:gsub("%s+", " "):gsub("^ ", ""):gsub(" $", ""))
end
M.norm = norm

--[[
The plain text of `html` and where each of its characters came from. `units[i]` = { tok, s, e } (byte span in the token's
text) for the i-th byte of `plain`, or false for a space inserted at a block boundary.
]]
local function index(html)
    local toks, plain, units = {}, {}, {}
    local n = 0
    local lastSpace = true
    local function emit(ch, unit)
        if ch == " " then
            if lastSpace then return end
            lastSpace = true
        else lastSpace = false end
        for k = 1, #ch do
            n = n + 1; plain[n] = ch:sub(k, k); units[n] = unit
        end
    end
    local pos, skip = 1, nil
    while pos <= #html do
        local lt = html:find("<", pos, true)
        local textEnd = (lt or (#html + 1)) - 1
        if textEnd >= pos then
            local t = html:sub(pos, textEnd)
            toks[#toks + 1] = { text = t }
            local ti = #toks
            if not skip then
                local i = 1
                while i <= #t do
                    local c = t:sub(i, i)
                    if c == "&" then
                        local e = t:match("^&([#%w]+);", i)
                        local dec = e and decodeEntity(e)
                        if dec then
                            local s, ee = i, i + #e + 1
                            emit(plainQuotes(dec), { ti, s, ee })
                            i = ee + 1
                        else emit("&", { ti, i, i }); i = i + 1 end
                    elseif c:match("%s") then emit(" ", { ti, i, i }); i = i + 1
                    else
                        -- one UTF-8 character at a time, so a mark never splits one
                        local len = c:byte() >= 0xF0 and 4 or c:byte() >= 0xE0 and 3 or c:byte() >= 0xC0 and 2 or 1
                        local ch = t:sub(i, i + len - 1)
                        if ch == "’" or ch == "‘" then ch = "'" elseif ch == "“" or ch == "”" then ch = '"' elseif ch == "\194\160" then ch = " " end
                        emit(ch, { ti, i, i + len - 1 })
                        i = i + len
                    end
                end
            end
        end
        if not lt then break end
        local gt = html:find(">", lt, true) or #html
        local tag = html:sub(lt, gt)
        toks[#toks + 1] = { tag = tag }
        local close, name = tag:match("^<(/?)([%w]+)")
        name = name and name:lower()
        if name == "script" or name == "style" then skip = close ~= "/" or nil end
        if name and BLOCK[name] then emit(" ", false) end
        pos = gt + 1
    end
    return toks, table.concat(plain), units
end

--[[--
Wraps every highlight found in `html`. marks = { { exact, prefix?, suffix?, class?, ref? } }; `ref` adds a footnote link
after the mark (`<sup><a href="#ref">*</a></sup>`). Returns the new html and the list of marks that were found.
]]
function M.apply(html, marks)
    local toks, plain, units = index(html)
    local inserts = {}   -- [tok] = { { at, before (bool: before byte `at`), text, order } }
    local found = {}
    local order = 0
    local function add(ti, at, after, text)
        order = order + 1
        inserts[ti] = inserts[ti] or {}
        table.insert(inserts[ti], { at = at, after = after, text = text, order = order })
    end
    for _, m in ipairs(marks) do
        local q = norm(m.exact or "")
        if #q >= 3 then
            -- every occurrence, scored by how well the saved context matches
            local best, bestScore, from = nil, -1, 1
            while true do
                local s = plain:find(q, from, true)
                if not s then break end
                local score = 0
                local pre, suf = norm(m.prefix or ""), norm(m.suffix or "")
                if pre ~= "" then
                    local before = norm(plain:sub(math.max(1, s - #pre - 2), s - 1))
                    if before:sub(-math.min(#pre, 24)) == pre:sub(-math.min(#pre, 24)) then score = score + 2 end
                end
                if suf ~= "" then
                    local after = norm(plain:sub(s + #q, s + #q + #suf + 2))
                    if after:sub(1, math.min(#suf, 24)) == suf:sub(1, math.min(#suf, 24)) then score = score + 2 end
                end
                if score > bestScore then best, bestScore = s, score end
                from = s + 1
            end
            if best then
                local e = best + #q - 1
                -- the text tokens the range touches, each wrapped on its own (marks never cross a tag)
                local segs, cur = {}, nil
                for k = best, e do
                    local u = units[k]
                    if u then
                        if cur and cur.tok == u[1] then cur.e = u[3]
                        else cur = { tok = u[1], s = u[2], e = u[3] }; segs[#segs + 1] = cur end
                    end
                end
                local cls = m.class and (' class="' .. m.class .. '"') or ""
                for k, sg in ipairs(segs) do
                    add(sg.tok, sg.s, false, "<mark" .. cls .. ">")
                    local close = "</mark>"
                    if k == #segs and m.ref then close = close .. '<sup><a class="aish-ref" href="#' .. m.ref .. '">' .. (m.refLabel or "*") .. "</a></sup>" end
                    add(sg.tok, sg.e, true, close)
                end
                found[#found + 1] = m
            end
        end
    end
    local out = {}
    for ti, tk in ipairs(toks) do
        if tk.tag then out[#out + 1] = tk.tag
        elseif not inserts[ti] then out[#out + 1] = tk.text
        else
            local list = inserts[ti]
            -- position in the text: an insert after byte b sits at b + 0.5; at the same spot closes come before opens
            table.sort(list, function(a, b)
                local pa, pb = a.after and a.at + 0.5 or a.at - 0.5, b.after and b.at + 0.5 or b.at - 0.5
                if pa ~= pb then return pa < pb end
                return a.order < b.order
            end)
            local t, last = tk.text, 0
            for _, ins in ipairs(list) do
                local cut = ins.after and ins.at or ins.at - 1
                out[#out + 1] = t:sub(last + 1, cut)
                out[#out + 1] = ins.text
                last = cut
            end
            out[#out + 1] = t:sub(last + 1)
        end
    end
    return table.concat(out), found
end

M._index = index
return M
