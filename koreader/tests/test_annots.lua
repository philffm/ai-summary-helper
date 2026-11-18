-- KOReader highlights ↔ AISH highlights for one article (annots.reconcile), with a stand-in book.
local A = require("aishlib.annots")
local function item(text, extra) local it = { text = text, drawer = "lighten", pos0 = "p0:" .. text, pos1 = "p1:" .. text, page = "p0:" .. text }; for k, v in pairs(extra or {}) do it[k] = v end; return it end
local made = 0
local function newHighlight(it) made = made + 1; return { id = "ko_" .. made, text = it.text, type = "user" } end
local function find(h) if h.text:find("nowhere") then return nil end return { pos0 = "x0", pos1 = "x1", page = "x0", text = h.text } end
local function newItem(h, placed, note) return { pos0 = placed.pos0, pos1 = placed.pos1, page = placed.page, text = placed.text, note = note, drawer = h.type == "ghost" and "underscore" or "lighten" } end

-- first open: AISH highlights appear (AI underlined, comment as note); one cannot be placed; a reader highlight goes to AISH
local items = { item("made on the reader", { note = "my thought" }), { page = "bookmark" } }
local base = {}
local hls = { { id = "h1", text = "a user highlight", type = "user" }, { id = "h2", text = "an AI highlight", type = "ghost" },
    { id = "h3", text = "text that is nowhere", type = "user" }, { id = "h4", text = "dismissed AI", type = "ghost", dismissed = true } }
local act = A.reconcile({ items = items, hls = hls, comments = { h1 = { text = "comment from the browser" } }, base = base, gone = {}, find = find, newItem = newItem, newHighlight = newHighlight })
assert(act.added == 2 and act.unplaced == 1, "two placed, one not found")
assert(#items == 4 and items[3].aish_id == "h1" and items[3].note == "comment from the browser" and items[4].drawer == "underscore", "added with note / underline")
assert(#act.create == 1 and act.create[1].id == "ko_1" and items[1].aish_id == "ko_1", "reader highlight → AISH")
assert(#act.comment == 1 and act.comment[1].hlId == "ko_1" and act.comment[1].text == "my thought", "its note → comment")
assert(base.h1.note == "comment from the browser" and base.ko_1.note == "my thought" and base.h2 and not base.h3)
hls[#hls + 1] = { id = "ko_1", text = "made on the reader", type = "user" }

-- a second run with nothing changed does nothing
act = A.reconcile({ items = items, hls = hls, comments = { h1 = { text = "comment from the browser" }, ko_1 = { text = "my thought" } }, base = base, gone = {}, find = find, newItem = newItem, newHighlight = newHighlight })
assert(act.added == 0 and act.removed == 0 and #act.create == 0 and #act.comment == 0 and #act.delete == 0 and act.notesHere == 0, "idle")

-- book closed (no find): note edited on the reader, comment edited in the browser on another highlight, the AI highlight removed on
-- the reader, h1's comment... and a highlight deleted in AISH
items[1].note = "my better thought"
local comments = { h1 = { text = "comment from the browser" }, ko_1 = { text = "my thought" } }
table.remove(items, 4)   -- the AI one, removed on the reader
act = A.reconcile({ items = items, hls = hls, comments = comments, base = base, gone = {}, newItem = newItem, newHighlight = newHighlight })
assert(#act.comment == 1 and act.comment[1].text == "my better thought", "note edit → comment")
assert(#act.dismiss == 1 and act.dismiss[1] == "h2" and #act.delete == 0, "AI highlight removed on the reader → dismissed")
comments.ko_1 = { text = "my better thought" }   -- what apply() wrote
comments.h1 = { text = "edited in the browser" }
act = A.reconcile({ items = items, hls = hls, comments = comments, base = base, gone = {}, newItem = newItem, newHighlight = newHighlight })
assert(act.notesHere == 1 and items[3].note == "edited in the browser", "comment edit → note")
-- both changed: the reader wins
items[3].note = "reader edit"; comments.h1 = { text = "browser edit" }
act = A.reconcile({ items = items, hls = hls, comments = comments, base = base, gone = {}, newItem = newItem, newHighlight = newHighlight })
assert(#act.comment == 1 and act.comment[1].text == "reader edit" and items[3].note == "reader edit", "the reader wins a conflict")
comments.h1 = { text = "reader edit" }
-- deleted in AISH → off the reader; an unknown id is NOT a deletion (sent again with its id)
items[#items + 1] = item("from before a reconnect", { aish_id = "ko_old" })
local n = #items
table.remove(hls, 1)   -- h1 deleted in AISH: no longer among the live highlights
act = A.reconcile({ items = items, hls = hls, comments = comments, base = base, gone = { h1 = true }, newItem = newItem, newHighlight = newHighlight })
assert(act.removed == 1 and #items == n - 1, "deleted in AISH: removed here " .. act.removed .. " " .. #items .. "/" .. n)
assert(#act.create == 1 and act.create[1].id == "ko_old", "unknown id sent again, same id")
-- removed on the reader (user highlight) → deleted in AISH
for i = #items, 1, -1 do if items[i].aish_id == "ko_1" then table.remove(items, i) end end
act = A.reconcile({ items = items, hls = hls, comments = comments, base = base, gone = {}, newItem = newItem, newHighlight = newHighlight })
assert(#act.delete == 1 and act.delete[1] == "ko_1", "user highlight removed on the reader → deleted")
-- a lost link (the same text, no aish_id) is linked again, not doubled nor deleted
local items2 = { item("a user highlight") }
local base2 = { h9 = { note = nil } }
base2.h9 = { }
local act2 = A.reconcile({ items = items2, hls = { { id = "h9", text = "a  user highlight", type = "user" } }, comments = {}, base = base2, gone = {}, newItem = newItem, newHighlight = newHighlight })
assert(items2[1].aish_id == "h9" and #act2.create == 0 and #act2.delete == 0, "re-linked by its text")
