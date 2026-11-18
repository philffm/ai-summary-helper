-- Run by interop.sh (skipped otherwise): pulls a place the extension made, over WebDAV with a login, and writes the HTML files.
local phase = os.getenv("AISH_PHASE")
if not phase then return end
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
package.path = here .. "/../aish.koplugin/?.lua;" .. here .. "/?.lua;" .. package.path
local fsu = require("fsutil")
local C, code = require("aishlib.crypto"), require("aishlib.code")
local json = require("aishlib.json")
local work = os.getenv("AISH_WORK")
local store = require("aishlib.webdav").new({ url = os.getenv("AISH_URL"), root = "My Library", username = "phil", password = "app pass/ü", http = require("socket.http") })
local lib = require("aishlib.library").new({ store = store, fs = fsu, dataDir = work .. "/data", outDir = work .. "/AISH", format = "html", labels = { summary = "Summary", notes = "Notes" } })

local meta = json.decode(assert(store.get("meta.json")))
lib.resetIfNewPlace(meta.salt)
assert(C.openMeta(meta, "orbit lemon tunnel paper river") == nil, "wrong passphrase refused")
local keys = assert(C.openMeta(meta, code.canonicalPassphrase("Orbit-Lemon-Tunnel-Paper-River-Cloud")))
local res = assert(lib.pull(keys))
local removed = {}
local m = lib.materialize(function(p) removed[#removed + 1] = p; os.remove(p) end)
local files = fsu.ls(work .. "/AISH")
local function read(name) return fsu.read(work .. "/AISH/" .. name) end
print(string.format("phase %s: fetched %d of %d, failed %d, written %d, removed %d, articles %d, files %s",
    phase, res.fetched, res.total, #res.failed, #m.written, #m.removed, m.articles, table.concat(files, " | ")))
assert(#res.failed == 0, "nothing failed: " .. json.encode(res.failed))

local sleepFile = "Why we sleep what the new studies show [ka1].html"
if phase == "1" then
    assert(res.fetched == 9 and #files == 3, "3 articles (the feed stub is not one)")
    local s = assert(read(sleepFile), "sleep article file")
    -- highlights are KOReader's own now (annots.lua): the text stays as saved, so their places in it never move
    assert(not s:find("<mark", 1, true) and s:find("During slow-wave sleep, the brain replays the day’s experiences", 1, true), "plain text")
    assert(s:find("Read again before the exam.", 1, true) and not s:find("Matches chapter 3", 1, true), "the note on the article; the comment goes on the highlight")
    local hls, comments = lib.highlightsOf("k-a1")
    assert(#hls == 2 and comments["h-1"] and comments["h-1"].text == "Matches chapter 3 of the textbook.", "highlights and comment ready for KOReader")
    assert(s:find("<li>Sleep consolidates memory.</li>", 1, true), "summary")
    assert(read("Only a summary here [ka3].html"):find("was not saved", 1, true), "summary-only article")
    local colls = {}
    for f, names in pairs(m.collections) do colls[#colls + 1] = f:match("[^/]+$") .. "=" .. table.concat(names, ",") end
    table.sort(colls)
    assert(#colls == 2 and colls[1]:find("Exam prep") and colls[2]:find("Exam prep"), "collection: " .. table.concat(colls, "; "))
    -- a second run with nothing new downloads and writes nothing
    local again = assert(lib.pull(keys)); local m2 = lib.materialize(function() end)
    assert(again.fetched == 0 and #m2.written == 0, "idle run is idle")
else
    assert(res.fetched == tonumber(os.getenv("AISH_CHANGED")) and res.fetched < res.total, "only the changed files: " .. res.fetched .. " of " .. tostring(os.getenv("AISH_CHANGED")))
    assert(#removed == 1 and removed[1]:find("four%-day week"), "deleted article removed")
    local s = assert(read(sleepFile))
    local hls = lib.highlightsOf("k-a1")
    assert(#hls == 3, "new highlight known")
    assert(s:find("Read again before the exam on Friday.", 1, true), "edited note")
    assert(read("Only a summary here [ka3].html"), "a renamed article keeps its file (KOReader's reading position stays)")
    assert(#files == 2)
end
print("TEST interop phase " .. phase .. " OK")
