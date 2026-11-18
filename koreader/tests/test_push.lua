-- Sending changes: conditional writes, and a write that lost the race (412) is merged with the server's copy and sent again,
-- so both edits survive. An in-memory server; the keys of sync-vector.json.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
local C, json, S = require("aishlib.crypto"), require("aishlib.json"), require("aishlib.stamps")
local fsu = require("fsutil")
local f = assert(io.open(here .. "/../../plugin/tests/fixtures/sync-vector.json", "rb")); local vec = json.decode(f:read("*a")); f:close()
local keys = assert(C.openMeta(vec.crypto.meta, vec.crypto.passphrase))

local files, n = {}, 0   -- name → { bytes, etag }
local server = {
    list = function() local out = {}; for name, x in pairs(files) do out[#out + 1] = { name = name, etag = x.etag } end return out end,
    get = function(p) local x = files[p:match("[^/]+$")]; if not x then return false end return x.bytes, x.etag end,
    put = function(p, bytes, o)
        local name = p:match("[^/]+$"); local cur = files[name]
        if o.ifNoneMatch == "*" and cur then return nil, "exists", 412 end
        if o.ifMatch and (not cur or cur.etag ~= o.ifMatch) then return nil, "changed", 412 end
        n = n + 1; files[name] = { bytes = bytes, etag = "e" .. n }; return "e" .. n
    end,
}
local function serverWrite(key, rec)   -- another device writes a record
    local typ, id = key:match("^(%a+):(.+)$")
    rec.aish, rec.key = "rec/1", key
    server.put("r/" .. C.nameOf(keys, typ, id), C.encryptFile(keys, json.encode(rec)), {})
end
local function serverRead(key)
    local typ, id = key:match("^(%a+):(.+)$")
    return json.decode(C.decryptFile(keys, files[C.nameOf(keys, typ, id)].bytes))
end

local dir = os.tmpname(); os.remove(dir); fsu.mkdirp(dir)
local clock = 1800000000000
local lib = require("aishlib.library").new({ store = server, fs = fsu, dataDir = dir .. "/data", outDir = dir .. "/out", now = function() clock = clock + 1; return clock end })
local other = { clock = { t = 0 }, now = 1700000000000, device = "browser" }

-- a highlight from the browser arrives
serverWrite("hl:h1", S.edit(nil, { id = "h1", url = "https://x.example/a", text = "some words", type = "ghost" }, other))
assert(lib.pull(keys).fetched == 1)
-- new record from the reader: written with If-None-Match
lib.edit("hl:k1", { id = "k1", url = "https://x.example/a", text = "reader words", type = "user", source = "koreader" })
local r = lib.push(keys)
assert(r.pushed == 1 and #r.failed == 0 and serverRead("hl:k1").values.source == "koreader", "new record sent")
assert(lib.pendingCount() == 0)
-- the reader dismisses h1 while the browser (unseen) edits its text: 412, merge, both survive
lib.edit("hl:h1", { dismissed = true })
other.now = 1700000000100
serverWrite("hl:h1", S.edit(serverRead("hl:h1"), { text = "some better words" }, other))
r = lib.push(keys)
assert(r.pushed == 1 and #r.failed == 0, "sent after the merge")
local final = serverRead("hl:h1")
assert(final.values.dismissed == true and final.values.text == "some better words", "both edits kept: " .. json.encode(final.values))
assert(lib.record("hl:h1").values.text == "some better words", "and here")
-- a deletion on the reader is a tombstone the browser understands
lib.delete("hl:k1"); assert(lib.push(keys).pushed == 1)
local t = serverRead("hl:k1"); assert(t.deleted == true and t.rev.d == lib.device and not t.values, "tombstone")
-- the server's copy cannot be read → not overwritten, kept for the next push
lib.edit("hl:h1", { text = "again" })
local name = C.nameOf(keys, "hl", "h1")
files[name] = { bytes = "\1garbage-garbage-garbage-garbage-garbage", etag = "broken" }
r = lib.push(keys)
assert(r.pushed == 0 and #r.failed == 1 and files[name].etag == "broken" and lib.pendingCount() == 1, "unreadable server copy is never overwritten")
os.execute("rm -rf '" .. dir .. "'")
