--[[--
KOReader's highlights ↔ Kaivo highlights, for one article.

KOReader keeps highlights in its own list (`annotations` in the book's sidecar: pos0/pos1, text, note, drawer, …). The
plugin keeps them in step with Kaivo:

  Kaivo → KOReader  a highlight saved in the browser appears as a KOReader highlight (AI highlights underlined) with its
                   comment as the note. Placing one needs the open book (to find the text), so this happens on opening.
  KOReader → Kaivo  a highlight made on the reader becomes a Kaivo highlight (with the words before and after it, as the
                   extension saves them); its note becomes the comment. Editing the note edits the comment.
  deletions        a highlight removed on the reader is deleted in Kaivo (an AI one is dismissed); one deleted in Kaivo
                   disappears from the reader.

Who changed a note is told by the last synced state (`base`): when only one side differs from it, that side wins; when
both do, the reader wins (it is the newer edit, made where the person is reading).

Each linked KOReader highlight carries `aish_id` (saved with it in the sidecar).

@module aishlib.annots
]]
local M = {}

local function norm(s) return (tostring(s or ""):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")) end
local function blank(s) return s == nil or not tostring(s):match("%S") end
local function noteOf(s) if blank(s) then return nil end return tostring(s) end

--[[--
o = {
  items     KOReader's annotations of the book (a list; changed in place),
  hls       the article's live Kaivo highlights { id, text, type, quote, dismissed },
  comments  hl id → { id, text } (the comment on it),
  gone      hl id → true for highlights deleted or dismissed in Kaivo (only these leave the reader; an unknown id does not),
  base      hl id → { note } (changed in place: what both sides hold after this),
  find      function(hl) → item fields { pos0, pos1, page, text, chapter? } or nil; nil when the book is not open,
  newItem   function(hl, placed, note) → the KOReader item to add (the caller knows drawer and colour),
  newHighlight function(item) → Kaivo values for a highlight made on the reader (url, text, quote, …), with .id,
  add / remove  optional: function(item) and function(index) to change `items` (KOReader's own addItem keeps its order)
}
→ actions { added = n, removed = n, notesHere = n, unplaced = n,
            create = { { id, values } }, comment = { { hlId, text|nil, quote } }, delete = { hlId }, dismiss = { hlId } }
]]
function M.reconcile(o)
    local items, base = o.items, o.base
    local add = o.add or function(it) items[#items + 1] = it end
    local remove = o.remove or function(i) table.remove(items, i) end
    local act = { added = 0, removed = 0, notesHere = 0, unplaced = 0, create = {}, comment = {}, delete = {}, dismiss = {} }
    local live = {}
    for _, h in ipairs(o.hls) do if not h.dismissed then live[h.id] = h end end
    local byId = {}
    for _, it in ipairs(items) do if it.aish_id then byId[it.aish_id] = it end end

    -- 1) KOReader items linked to Kaivo: deleted / dismissed in Kaivo → off the reader; notes in step
    for i = #items, 1, -1 do
        local it = items[i]
        local id = it.aish_id
        if id and it.drawer then
            local h = live[id]
            if not h and o.gone[id] then   -- deleted or dismissed in Kaivo
                remove(i); base[id] = nil; act.removed = act.removed + 1
            elseif not h then              -- unknown here (never sent, or this reader was connected anew): sent again with its id
                local values = o.newHighlight(it)
                if values then
                    values.id = id
                    act.create[#act.create + 1] = { id = id, values = values }
                    local note = noteOf(it.note)
                    if note then act.comment[#act.comment + 1] = { hlId = id, text = note, quote = norm(it.text) } end
                    base[id] = { note = note }
                end
            else
                local b = base[id] and base[id].note
                local here, there = noteOf(it.note), noteOf(o.comments[id] and o.comments[id].text)
                if here ~= b then   -- changed on the reader (it wins over a change in Kaivo too)
                    if here ~= there then act.comment[#act.comment + 1] = { hlId = id, text = here, quote = norm(h.text) } end
                    base[id] = { note = here }
                elseif there ~= b then
                    it.note = there; act.notesHere = act.notesHere + 1
                    base[id] = { note = there }
                else base[id] = base[id] or { note = here } end
            end
        end
    end

    -- 1b) a reader highlight without a link that has the text of an unlinked Kaivo one is that one (a link lost when the book
    --     was closed before its settings were saved, or the same passage highlighted in both places): linked, not doubled
    local unlinked = {}
    for _, h in ipairs(o.hls) do if not h.dismissed and not byId[h.id] then unlinked[norm(h.text)] = unlinked[norm(h.text)] or h end end
    for _, it in ipairs(items) do
        if it.drawer and not it.aish_id and not blank(it.text) then
            local h = unlinked[norm(it.text)]
            if h then
                it.aish_id = h.id; byId[h.id] = it; unlinked[norm(it.text)] = nil
                local here, there = noteOf(it.note), noteOf(o.comments[h.id] and o.comments[h.id].text)
                if here and here ~= there then act.comment[#act.comment + 1] = { hlId = h.id, text = here, quote = norm(h.text) }
                elseif not here and there then it.note = there; act.notesHere = act.notesHere + 1 end
                base[h.id] = { note = here or there }
            end
        end
    end

    -- 2) Kaivo highlights without a KOReader item: removed on the reader, or new here
    for _, h in ipairs(o.hls) do
        if not h.dismissed and not byId[h.id] then
            if base[h.id] then   -- it was on the reader at the last sync: removed there
                if h.type == "ghost" then act.dismiss[#act.dismiss + 1] = h.id else act.delete[#act.delete + 1] = h.id end
                base[h.id] = nil
            elseif o.find then
                local placed = o.find(h)
                if placed then
                    local note = noteOf(o.comments[h.id] and o.comments[h.id].text)
                    local it = o.newItem(h, placed, note)
                    it.aish_id = h.id
                    add(it)
                    byId[h.id] = it
                    base[h.id] = { note = note }
                    act.added = act.added + 1
                else act.unplaced = act.unplaced + 1 end
            end
        end
    end

    -- 3) highlights made on the reader → Kaivo
    for _, it in ipairs(items) do
        if it.drawer and not it.aish_id and not blank(it.text) then
            local values = o.newHighlight(it)
            if values then
                it.aish_id = values.id
                act.create[#act.create + 1] = { id = values.id, values = values }
                local note = noteOf(it.note)
                if note then act.comment[#act.comment + 1] = { hlId = values.id, text = note, quote = norm(it.text) } end
                base[values.id] = { note = note }
            end
        end
    end
    return act
end

--- Applies the Kaivo side of `act` to the library (records go out at the next push). `base` becomes the article's links.
function M.apply(lib, articleId, act, base)
    for _, c in ipairs(act.create) do lib.edit("hl:" .. c.id, c.values) end
    for _, c in ipairs(act.comment) do
        local key = "note:c_" .. c.hlId
        local cur = lib.index[key] and not lib.index[key].deleted
        if c.text then
            if cur then lib.edit(key, { text = c.text })
            else
                lib.edit(key, { id = "c_" .. c.hlId, kind = "comment", highlightId = c.hlId, created = lib.isoNow(), text = c.text, url = lib.pageKeyOf(articleId) })
            end
        elseif cur then lib.delete(key) end
    end
    for _, id in ipairs(act.delete) do
        lib.delete("hl:" .. id)
        if lib.index["note:c_" .. id] then lib.delete("note:c_" .. id) end
    end
    for _, id in ipairs(act.dismiss) do lib.edit("hl:" .. id, { dismissed = true }) end
    lib.setLinks(articleId, base)   -- saved by the caller (lib.flush) after the batch
end

--- Kaivo values for a highlight made on the reader.
function M.highlightValues(lib, articleId, item)
    local json = require("aishlib.json")
    local text = norm(item.text)
    local url = lib.pageKeyOf(articleId)
    if text == "" or not url then return nil end
    local prefix, suffix = lib.quoteContext(articleId, text)
    return { id = lib.newId("ko"), url = url, text = text, type = "user", timestamp = lib.isoNow(),
        quote = json.object({ exact = text, prefix = prefix, suffix = suffix }), v = 2, source = "koreader" }
end

return M
