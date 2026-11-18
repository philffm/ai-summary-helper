--[[--
Sync of one encrypted AISH place with a folder of HTML files on the reader.

  pull()        every record file whose ETag changed is downloaded, decrypted and checked, and kept on this device
                (one JSON file per record; a lean index lists them). A record changed here and not sent yet is merged
                with the server's copy by the extension's rules (per field, newer stamp wins).
  edit() / delete()  changes made on the reader (highlights, notes, read state): stamped like the extension stamps them.
  push()        sends those changes: each file is written only if the server's copy is still the one we know (If-Match);
                when someone else wrote it first, the two are merged and it is tried once more.
  materialize() articles → HTML files (with their highlights and notes), deleted articles → files removed. Only files this
                plugin made are touched; what changed is found from the record's stamp and a digest of its highlights and notes.

Safety rules, the same as the extension's engine where they apply to reading (plugin/src/modules/syncEngine.js):
  • a file that cannot be read, decrypted or checked is skipped and reported, and tried again next time; it is never a deletion;
  • a record whose name does not match its key (a file copied or swapped on the server) is refused;
  • only an explicit deletion marker (a tombstone) removes an article here; a record missing from the listing does not.

@module aishlib.library
]]
local crypto = require("aishlib.crypto")
local json = require("aishlib.json")
local render = require("aishlib.render")
local stamps = require("aishlib.stamps")
local marks = require("aishlib.marks")
local epub = require("aishlib.epub")

local M = {}
local TYPES = { article = true, hl = true, coll = true, note = true }
local KEY_RX = "^(%a+):([%w_%.:%-]+)$"
M.RECORD_DIR = "r"
M.RENDER_VERSION = "4"   -- 2: no marks in the text (KOReader's highlights keep their place); 3: chapters, key points, images; 4: made covers
M.IMAGE_MAX = 3 * 1024 * 1024          -- one image (bytes); larger ones keep only their description
M.IMAGES_PER_ARTICLE = 12 * 1024 * 1024
M.IMAGE_DIR = ".images"                 -- hidden in KOReader's file browser

--- "2026-11-02T10:00:00.000Z" → seconds since 1970 (UTC), or nil
function M.isoToEpoch(iso)
    local y, mo, d, h, mi, sec = tostring(iso or ""):match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)")
    if not y then return nil end
    y, mo, d = tonumber(y), tonumber(mo), tonumber(d)
    if mo <= 2 then y = y - 1; mo = mo + 12 end   -- days from civil (Howard Hinnant)
    local era = math.floor(y / 400)
    local yoe = y - era * 400
    local doy = math.floor((153 * (mo - 3) + 2) / 5) + d - 1
    local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
    local days = era * 146097 + doe - 719468
    return days * 86400 + tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(sec)
end

-- ── page keys (plugin/src/modules/pageKey.js) ─────────────────────────────────
local KEEP = { "article", "currentJobId", "id", "item", "pid", "postId", "story_fbid", "v" }   -- sorted, like the extension
function M.pageKey(href)
    href = tostring(href or ""):gsub("#.*$", "")
    local scheme, hostport, path, query = href:match("^(%a[%w+.-]*)://([^/?]*)([^?]*)%??(.*)$")
    if not scheme then return (href:gsub("%?.*$", "")) end
    hostport = hostport:gsub("^.*@", ""):lower()
    if (scheme:lower() == "https" and hostport:match(":443$")) or (scheme:lower() == "http" and hostport:match(":80$")) then
        hostport = hostport:gsub(":%d+$", "")
    end
    if path == "" then path = "/" end
    local params = {}
    for part in query:gmatch("[^&]+") do
        local k, v = part:match("^([^=]+)=(.*)$")
        if k and v ~= "" and params[k] == nil then params[k] = v end
    end
    local keep = {}
    for _, k in ipairs(KEEP) do if params[k] then keep[#keep + 1] = k .. "=" .. params[k] end end
    return scheme:lower() .. "://" .. hostport .. path .. (#keep > 0 and ("?" .. table.concat(keep, "&")) or "")
end
local function looseKey(href) return (M.pageKey(href):gsub("/+$", ""):gsub("^https?://www%.", "https://"):gsub("^http://", "https://")) end

-- ── the local record store ───────────────────────────────────────────────────
--[[--
o = { store = webdav store, dataDir, outDir, fs = { mkdirp, exists, read, write, remove }, labels, now }
]]
function M.new(o)
    local self = { store = o.store, fs = o.fs, dataDir = o.dataDir, outDir = o.outDir, labels = o.labels or {} }
    local fs = o.fs
    self.format = o.format == "html" and "html" or "epub"   -- EPUB: book information, cover, table of contents
    self.cover = o.cover    -- function(info) → PNG bytes: draws an article's cover (KOReader on the reader)
    fs.mkdirp(self.dataDir .. "/records")

    local function readJson(path)
        local text = fs.read(path)
        if not text then return nil end
        return json.decode(text)
    end
    local function writeJson(path, v) fs.write(path, json.encode(v)) end
    local function recPath(key) return self.dataDir .. "/records/" .. key:gsub(":", "~"):gsub("[^%w_%.~%-]", "_") .. ".json" end

    self.index = readJson(self.dataDir .. "/index.json") or {}      -- key → { t, deleted, type }
    self.ledger = readJson(self.dataDir .. "/ledger.json") or {}    -- { salt, items = { [file name] = etag } }
    self.state = readJson(self.dataDir .. "/files.json") or {}      -- article id → { file, sig }
    self.ledger.items = self.ledger.items or {}
    self.links = readJson(self.dataDir .. "/links.json") or {}      -- article id → { hl id → { note } }: what KOReader showed at the last sync
    local dev = readJson(self.dataDir .. "/device.json") or {}
    if not dev.device then dev.device = "koreader-" .. crypto.toHex(crypto.randomBytes(5)) end
    self.device, self.clock = dev.device, { t = tonumber(dev.clock) or 0 }
    self.now = o.now or function() return math.floor(os.time() * 1000) end

    function self.record(key) return readJson(recPath(key)) end
    local function save()
        writeJson(self.dataDir .. "/index.json", self.index)
        writeJson(self.dataDir .. "/ledger.json", self.ledger)
        writeJson(self.dataDir .. "/links.json", json.object(self.links))
        writeJson(self.dataDir .. "/device.json", { device = self.device, clock = self.clock.t })
    end
    self.save = save
    -- edits mark the state as changed; the caller saves once (flush) after a batch: saving after each of hundreds of
    -- articles rewrote the whole index each time and made "Writing articles" crawl on an e-reader
    local unsaved = false
    function self.flush() if unsaved then save(); unsaved = false end end
    local function ctx() return { clock = self.clock, now = self.now(), device = self.device } end
    local function digest(parts) return crypto.toHex(crypto.hmac("aish-koreader", table.concat(parts, "\0"))):sub(1, 24) end
    local RENDER_FIELDS = { "title", "url", "timestamp", "summaryBase", "summary", "content", "byline", "author", "language", "lang" }
    --- What an article's file is drawn from, as a digest, and whether it gets a file at all (computed when the record
    --- arrives, so a sync with nothing new reads no article records)
    local function articleLean(v)
        local function str(x) x = json.val(x); return type(x) == "string" and x or nil end
        local skip = json.val(v.feedStub) or json.val(v.savedOnly)
            or not ((str(v.content) or ""):match("%S") or (str(v.summaryBase) or ""):match("%S") or (str(v.summary) or ""):match("%S"))
        local parts = {}   -- the render version is added when the files are written, never kept in the index
        for _, fld in ipairs(RENDER_FIELDS) do parts[#parts + 1] = fld .. "=" .. (str(v[fld]) or "") end
        return digest(parts), skip and true or nil
    end
    local gathered   -- gather()'s result until a record changes
    local function store(key, rec, dirty)
        gathered = nil
        rec.aish, rec.key = "rec/1", key
        fs.write(recPath(key), json.encode(rec))
        local typ = key:match(KEY_RX)
        local e = { t = tonumber(rec.rev and rec.rev.t) or 0, deleted = rec.deleted == true or nil, type = typ, dirty = dirty or nil }
        if typ == "article" and not rec.deleted and rec.values then   -- what the highlights need, without reading the record
            e.u = type(rec.values.url) == "string" and rec.values.url or nil
            e.fu = type(rec.values.feedUrl) == "string" and rec.values.feedUrl ~= "" and rec.values.feedUrl or nil
            e.rs, e.sk = articleLean(rec.values)
            e.ti = type(rec.values.title) == "string" and rec.values.title or nil
            -- the AISH tabs and tags, for the KOReader collections
            local v = rec.values
            e.ts = type(v.timestamp) == "string" and v.timestamp or nil
            e.ra = json.val(v.readAt) and true or nil
            e.ar = json.val(v.archived) == true or nil
            local tags = {}
            for f, x in pairs(v) do if f:sub(1, 4) == "tag:" and type(x) == "string" and x ~= "" then tags[#tags + 1] = x end end
            table.sort(tags)
            e.tg = #tags > 0 and json.array(tags) or nil
            e.lv = 3   -- which of these the entry holds (an older entry is filled in from its record once)
        end
        self.index[key] = e
    end

    --- Starts over when the place on the server was made anew (another salt): the old records belong to another library.
    function self.resetIfNewPlace(salt)
        if self.ledger.salt and self.ledger.salt ~= salt then
            for key in pairs(self.index) do fs.remove(recPath(key)) end
            self.index, self.ledger = {}, { items = {} }
        end
        self.ledger.salt = salt
    end

    --- A record from the server: merged with the copy here (which may hold changes not sent yet).
    function self.ingest(rec, name, etag, res)
        local cur = self.index[rec.key]
        local mine = cur and self.record(rec.key)
        stamps.observe(self.clock, tonumber(rec.rev.t))
        local remote = { rev = rec.rev, f = rec.f or json.object(), values = rec.values or json.object(), deleted = rec.deleted == true or nil }
        if not mine then
            store(rec.key, remote, false)
            if res then res.changed[rec.key] = true end
        else
            local merged, changedLocal, changedRemote = stamps.mergeRecord(mine, remote)
            if changedLocal or (cur.dirty and not changedRemote) then
                store(rec.key, merged, changedRemote)
                if res and changedLocal then res.changed[rec.key] = true end
            elseif changedRemote and not cur.dirty then
                cur.dirty = true   -- the server holds an older copy: ours goes out at the next push
            end
        end
        self.ledger.items[name] = etag
    end

    --[[--
    Downloads what changed. → { fetched, failed = { {name, reason} }, changed = { key = true }, total }, or nil, reason.
    progress(done, todo) is called while files come in.
    ]]
    function self.pull(keys, progress)
        local list, err = self.store.list(M.RECORD_DIR)
        if not list then return nil, err end
        local todo = {}
        for _, e in ipairs(list) do
            if e.name:match("^%x+$") and self.ledger.items[e.name] ~= e.etag then todo[#todo + 1] = e end
        end
        local res = { fetched = 0, failed = {}, changed = {}, total = #list }
        for i, e in ipairs(todo) do
            if progress then progress(i - 1, #todo) end
            local bytes, gerr = self.store.get(M.RECORD_DIR .. "/" .. e.name)
            local reason
            if bytes == false then reason = "gone"
            elseif not bytes then reason = gerr
            else
                local text, derr = crypto.decryptFile(keys, bytes)
                local rec = text and json.decode(text)
                local typ, id
                if type(rec) == "table" and type(rec.key) == "string" then typ, id = rec.key:match(KEY_RX) end
                if not text then reason = derr
                elseif type(rec) ~= "table" or rec.aish ~= "rec/1" or not typ or not TYPES[typ] or type(rec.rev) ~= "table" then reason = "not a record"
                elseif crypto.nameOf(keys, typ, id) ~= e.name then reason = "name does not match its record"
                else
                    self.ingest(rec, e.name, e.etag, res)
                    res.fetched = res.fetched + 1
                end
            end
            if reason and reason ~= "gone" then res.failed[#res.failed + 1] = { name = e.name, reason = reason } end
            if i % 100 == 0 then save() end   -- a long first run keeps what it has if it stops
        end
        save()
        if progress then progress(#todo, #todo) end
        return res
    end

    -- ── changes made on the reader ──────────────────────────────────────────────
    --- Sets fields of a record (a nil / json.null value removes one). The change goes out at the next push.
    function self.edit(key, changes)
        local cur = self.index[key] and self.record(key)
        local rec, changed = stamps.edit(cur, changes, ctx())
        if changed then store(key, rec, true); unsaved = true end
        return changed
    end
    --- Deletes a record everywhere (only for a deletion made on the reader).
    function self.delete(key)
        local cur = self.index[key]
        if not cur or cur.deleted then return false end
        store(key, stamps.tombstone(ctx()), true); unsaved = true
        return true
    end
    function self.setLinks(articleId, base) self.links[articleId] = base; unsaved = true end
    function self.pendingCount()
        local n = 0
        for _, e in pairs(self.index) do if e.dirty then n = n + 1 end end
        return n
    end

    local function fileRecord(key, rec)
        if rec.deleted then return { aish = "rec/1", key = key, rev = rec.rev, f = json.object(), deleted = true } end
        return { aish = "rec/1", key = key, rev = rec.rev, f = rec.f or json.object(), values = rec.values or json.object() }
    end

    --[[--
    Sends the changes made here. → { pushed, failed = { {key, reason} } }
    ]]
    function self.push(keys, progress)
        local res = { pushed = 0, failed = {} }
        local todo = {}
        for key, e in pairs(self.index) do if e.dirty then todo[#todo + 1] = key end end
        table.sort(todo)
        for i, key in ipairs(todo) do
            if progress then progress(i - 1, #todo) end
            local typ, id = key:match(KEY_RX)
            local name = crypto.nameOf(keys, typ, id)
            local path = M.RECORD_DIR .. "/" .. name
            local ok, reason
            for attempt = 1, 2 do
                local rec = self.record(key)
                if not rec then reason = "the record is missing here"; break end
                local known = self.ledger.items[name]
                local etag, err, status = self.store.put(path, crypto.encryptFile(keys, json.encode(fileRecord(key, rec))),
                    known and { ifMatch = known } or { ifNoneMatch = "*" })
                if etag then
                    self.ledger.items[name] = etag ~= "" and etag or nil
                    self.index[key].dirty = nil
                    ok = true; break
                end
                reason = err
                if status ~= 412 or attempt == 2 then break end
                -- someone else wrote it first: merge with their copy, then try once more
                local bytes, etagNow = self.store.get(path)
                if bytes == false then self.ledger.items[name] = nil
                elseif not bytes then reason = etagNow; break
                else
                    local text, derr = crypto.decryptFile(keys, bytes)
                    local remote = text and json.decode(text)
                    if type(remote) ~= "table" or remote.key ~= key then reason = derr or "the server copy cannot be read, not overwriting it"; break end
                    self.ingest(remote, name, etagNow)
                    self.index[key].dirty = true
                end
            end
            if ok then res.pushed = res.pushed + 1 else res.failed[#res.failed + 1] = { key = key, reason = reason } end
            if i % 25 == 0 then save() end
        end
        save(); unsaved = false
        if progress then progress(#todo, #todo) end
        return res
    end

    -- ── materialize ──────────────────────────────────────────────────────────
    local function live(key)
        local e = self.index[key]
        if not e or e.deleted then return nil end
        local rec = self.record(key)
        return rec and not rec.deleted and type(rec.values) == "table" and rec or nil
    end

    --- Highlights, notes and collections grouped for the articles.
    local function gather()
        if gathered then return (table.unpack or unpack)(gathered) end
        local hlByPage, notesByPage, notesByHl, collsOf = {}, {}, {}, {}
        for key, e in pairs(self.index) do
            if not e.deleted then
                local typ, id = key:match(KEY_RX)
                if typ == "hl" then
                    local r = live(key)
                    local v = r and r.values
                    if v and v.text and v.url then
                        local pk = looseKey(v.url)
                        hlByPage[pk] = hlByPage[pk] or {}
                        table.insert(hlByPage[pk], { id = id, text = json.val(v.text), type = json.val(v.type), quote = type(v.quote) == "table" and v.quote or nil, dismissed = json.val(v.dismissed), t = r.rev.t })
                    end
                elseif typ == "note" then
                    local r = live(key)
                    local v = r and r.values
                    if v and type(v.text) == "string" then
                        local n = { id = id, kind = json.val(v.kind), text = v.text, highlightId = json.val(v.highlightId), quote = type(v.quote) == "string" and v.quote or nil, created = json.val(v.created) }
                        if n.highlightId then notesByHl[n.highlightId] = notesByHl[n.highlightId] or {}; table.insert(notesByHl[n.highlightId], n)
                        elseif type(v.url) == "string" and v.url ~= "" then
                            local pk = looseKey(v.url)
                            notesByPage[pk] = notesByPage[pk] or {}; table.insert(notesByPage[pk], n)
                        end
                    end
                elseif typ == "coll" then
                    local r = live(key)
                    local v = r and r.values
                    if v and type(v.name) == "string" then
                        for field, src in pairs(v) do
                            local aid = field:match("^src:(.+)$")
                            if aid and src ~= json.null then collsOf[aid] = collsOf[aid] or {}; table.insert(collsOf[aid], v.name) end
                        end
                    end
                end
            end
        end
        local byOrder = function(x, y) return (x.t or 0) < (y.t or 0) or ((x.t or 0) == (y.t or 0) and tostring(x.id) < tostring(y.id)) end
        for _, l in pairs(hlByPage) do table.sort(l, byOrder) end
        local byCreated = function(x, y) return tostring(x.created or "") .. x.id < tostring(y.created or "") .. y.id end
        for _, l in pairs(notesByPage) do table.sort(l, byCreated) end
        for _, l in pairs(notesByHl) do table.sort(l, byCreated) end
        for _, l in pairs(collsOf) do table.sort(l) end
        gathered = { hlByPage, notesByPage, notesByHl, collsOf }
        return hlByPage, notesByPage, notesByHl, collsOf
    end


    --[[--
    Writes the HTML files. → { written = { path }, removed = { path }, collections = { [path] = { names } }, skipped }
    removeFile(path) is called for a file to remove (the plugin also drops KOReader's sidecar there).
    ]]
    function self.materialize(removeFile, progress)
        fs.mkdirp(self.outDir)
        local hlByPage, notesByPage, _, collsOf = gather()
        local res = { written = {}, removed = {}, collections = {}, skipped = 0, articles = 0, tabs = { inbox = {}, read = {}, archive = {} }, tags = {} }
        local used = {}
        for _, st in pairs(self.state) do used[st.file] = true end
        -- the series of an EPUB: its first AISH collection (by name), numbered by the date the articles were saved
        local seriesOf, members = {}, {}
        for aid, names in pairs(collsOf) do
            local e = self.index["article:" .. aid]
            if e and not e.deleted and names[1] then
                members[names[1]] = members[names[1]] or {}
                table.insert(members[names[1]], { id = aid, ts = e.ts or "" })
            end
        end
        for name, list in pairs(members) do
            table.sort(list, function(x, y) return x.ts < y.ts or (x.ts == y.ts and x.id < y.id) end)
            for i, it in ipairs(list) do seriesOf[it.id] = { name = name, index = i } end
        end
        local total, done = 0, 0
        if progress then for key in pairs(self.index) do if key:sub(1, 8) == "article:" then total = total + 1 end end end
        for key, e in pairs(self.index) do
            local typ, id = key:match(KEY_RX)
            if typ == "article" then
                done = done + 1
                if progress and done % 25 == 0 then progress(done, total) end
                local st = self.state[id]
                -- from the index when it knows the article (no record to read); else from the record
                local rec, v
                local lean = e.lv == 3
                if not e.deleted and not lean then
                    rec = live(key); v = rec and rec.values
                    if v then store(key, rec, e.dirty); e = self.index[key] end   -- an index from an older version: filled in once
                end
                local skip = e.deleted or e.sk or not e.rs
                if skip then
                    if e.deleted and st then   -- deleted in AISH: remove what this plugin made
                        if fs.exists(st.file) then removeFile(st.file) end
                        local safe = tostring(id):gsub("[^%w%-_]", "_")
                        for k = 1, (st.imgs or 0) do for _, ext in ipairs({ "jpg", "png", "gif", "webp", "svg" }) do fs.remove(self.outDir .. "/" .. M.IMAGE_DIR .. "/" .. safe .. "-" .. k .. "." .. ext) end end
                        res.removed[#res.removed + 1] = st.file
                        used[st.file] = nil; self.state[id] = nil
                    elseif not e.deleted then res.skipped = res.skipped + 1 end
                else
                    res.articles = res.articles + 1
                    local pages = { looseKey(e.u) }
                    if e.fu and e.fu ~= "" then pages[#pages + 1] = looseKey(e.fu) end
                    -- highlights live in KOReader (see annots.lua); the file holds the text and your notes on the article.
                    -- Its signature covers only what is drawn, so a highlight or a read mark never rewrites it (a rewrite of
                    -- the text would move KOReader's highlights)
                    local notes = {}
                    for _, pk in ipairs(pages) do
                        for _, n in ipairs(notesByPage[pk] or {}) do notes[#notes + 1] = n end
                    end
                    -- key points: the AI highlights of the article (after the text: a change there moves no highlight)
                    local keyPoints, seenKp = {}, {}
                    for _, pk in ipairs(pages) do
                        for _, h in ipairs(hlByPage[pk] or {}) do
                            if h.type == "ghost" and not h.dismissed and h.text and not seenKp[h.text] then seenKp[h.text] = true; keyPoints[#keyPoints + 1] = h.text end
                        end
                    end
                    -- the render version belongs here: kept in the index it would never change for articles already
                    -- there, and a new layout (like the covers) would not reach them
                    local parts = { M.RENDER_VERSION, e.rs }
                    for _, n in ipairs(notes) do parts[#parts + 1] = n.id .. ":" .. n.text .. ":" .. (n.quote or "") end
                    for _, k in ipairs(keyPoints) do parts[#parts + 1] = "kp:" .. k end
                    -- an EPUB carries tags and the series in its book information: those count too
                    local series, seriesIndex = seriesOf[id] and seriesOf[id].name, seriesOf[id] and seriesOf[id].index
                    if self.format == "epub" then
                        parts[#parts + 1] = "epub"
                        for _, tg in ipairs(e.tg or {}) do parts[#parts + 1] = "tag:" .. tg end
                        if series then parts[#parts + 1] = "series:" .. series .. "#" .. seriesIndex end
                    end
                    local sig = digest(parts)
                    local file = st and st.file
                    if file and not file:find("%." .. self.format .. "$") then   -- the format was changed: a new file
                        if fs.exists(file) then removeFile(file) end
                        local safe = tostring(id):gsub("[^%w%-_]", "_")
                        for k = 1, (st.imgs or 0) do for _, ext in ipairs({ "jpg", "png", "gif", "webp", "svg" }) do fs.remove(self.outDir .. "/" .. M.IMAGE_DIR .. "/" .. safe .. "-" .. k .. "." .. ext) end end
                        used[file] = nil; file = nil; st = nil
                    end
                    if not file then
                        local name = render.fileName(e.ti, id, self.format)
                        file = self.outDir .. "/" .. name
                        local k = 2
                        while used[file] or fs.exists(file) do file = self.outDir .. "/" .. name:gsub("%.%a+$", " " .. k .. "." .. self.format); k = k + 1 end
                    end
                    if not (st and st.sig == sig and fs.exists(file)) then
                        if not v then rec = live(key); v = rec and rec.values end
                        if v then
                            local vals = {}
                            for f, x in pairs(v) do vals[f] = json.val(x) end
                            -- images saved inside the article → files in .images/ next to it (within the caps)
                            local imgDir, safe, total, nImgs = self.outDir .. "/" .. M.IMAGE_DIR, tostring(id):gsub("[^%w%-_]", "_"), 0, 0
                            for k = 1, (st and st.imgs or 0) do for _, ext in ipairs({ "jpg", "png", "gif", "webp", "svg" }) do fs.remove(imgDir .. "/" .. safe .. "-" .. k .. "." .. ext) end end
                            local function image(mime, b64, k)
                                local size = math.floor(#b64 * 3 / 4)
                                if size > M.IMAGE_MAX or total + size > M.IMAGES_PER_ARTICLE then return nil end
                                local ext = ({ jpeg = "jpg", jpg = "jpg", png = "png", gif = "gif", webp = "webp", ["svg+xml"] = "svg" })[mime]
                                local bytes = ext and crypto.fromB64Fast(b64)
                                if not bytes then return nil end
                                if nImgs == 0 then fs.mkdirp(imgDir) end
                                fs.write(imgDir .. "/" .. safe .. "-" .. k .. "." .. ext, bytes)
                                total, nImgs = total + #bytes, math.max(nImgs, k)
                                return M.IMAGE_DIR .. "/" .. safe .. "-" .. k .. "." .. ext
                            end
                            if self.format == "epub" then
                                local tags = {}
                                for _, tg in ipairs(e.tg or {}) do tags[#tags + 1] = tg end
                                fs.write(file, (epub.build(vals, notes, self.labels, { id = id, keyPoints = keyPoints, tags = tags, series = series,
                                    seriesIndex = seriesIndex, imageMax = M.IMAGE_MAX, imagesMax = M.IMAGES_PER_ARTICLE, modified = M.isoToEpoch(e.ts), cover = self.cover })))
                            else
                                fs.write(file, render.article(vals, {}, notes, self.labels, { keyPoints = keyPoints, image = image }))
                            end
                            res.written[#res.written + 1] = file
                            st = { imgs = nImgs }
                        end
                    end
                    -- the file's date is the day it was saved in AISH: "sort by date modified" lists the newest first
                    local mt = M.isoToEpoch(e.ts)
                    if mt and fs.touch and (not self.state[id] or self.state[id].mt ~= mt or res.written[#res.written] == file) then fs.touch(file, mt) end
                    used[file] = true
                    self.state[id] = { file = file, sig = sig, imgs = st and st.imgs or 0, mt = mt }
                    -- the AISH tabs and tags
                    local item = { file = file, ts = e.ts or "" }
                    local tab = e.ar and "archive" or (e.ra and "read" or "inbox")
                    table.insert(res.tabs[tab], item)
                    for _, tg in ipairs(e.tg or {}) do
                        res.tags[tg] = res.tags[tg] or {}
                        table.insert(res.tags[tg], item)
                    end
                    if collsOf[id] then res.collections[file] = collsOf[id] end
                end
            end
        end
        local newest = function(x, y) return x.ts > y.ts or (x.ts == y.ts and x.file < y.file) end
        for _, list in pairs(res.tabs) do table.sort(list, newest) end
        for _, list in pairs(res.tags) do table.sort(list, newest) end
        writeJson(self.dataDir .. "/files.json", self.state)
        save()
        return res
    end

    -- ── for KOReader's highlights (annots.lua) ───────────────────────────────────
    --- The article id of a file this plugin made, or nil.
    function self.articleOfFile(path)
        for id, st in pairs(self.state) do if st.file == path then return id end end
    end
    function self.article(id) return live("article:" .. id) end
    function self.pageKeyOf(id)
        local r = live("article:" .. id)
        return r and type(r.values.url) == "string" and M.pageKey(r.values.url) or nil
    end
    --- The live highlights of an article (AI ones included, dismissed ones too: the caller decides) and the comment on each.
    function self.highlightsOf(id)
        local e = self.index["article:" .. id]
        if not e or e.deleted then return {}, {} end
        local v
        if e.u then v = { url = e.u, feedUrl = e.fu }
        else   -- an index from before the url was kept in it
            local r = live("article:" .. id)
            if not r then return {}, {} end
            v = r.values
        end
        local hlByPage, _, notesByHl = gather()
        local out, comments, seen = {}, {}, {}
        local pages = { looseKey(v.url) }
        if type(v.feedUrl) == "string" and v.feedUrl ~= "" then pages[#pages + 1] = looseKey(v.feedUrl) end
        for _, pk in ipairs(pages) do
            for _, h in ipairs(hlByPage[pk] or {}) do
                if not seen[h.id] then
                    seen[h.id] = true; out[#out + 1] = h
                    local list = notesByHl[h.id]
                    if list then comments[h.id] = list[#list] end
                end
            end
        end
        return out, comments
    end
    --- hl id → true for highlights deleted (tombstone) or dismissed in AISH.
    function self.goneHighlights()
        local gone = {}
        for key, e in pairs(self.index) do
            local typ, id = key:match(KEY_RX)
            if typ == "hl" then
                if e.deleted then gone[id] = true
                else
                    local r = self.record(key)
                    if r and (r.deleted or (r.values and json.val(r.values.dismissed))) then gone[id] = true end
                end
            end
        end
        return gone
    end
    --- prefix / suffix (about 32 characters each, as the extension saves them) around `text` in an article's file.
    function self.quoteContext(id, text)
        local r = live("article:" .. id)
        local content = r and json.val(r.values.content)
        if type(content) ~= "string" then return "", "" end
        local _, plain = marks._index(render.clean(content))
        local q = marks.norm(text or "")
        local s = q ~= "" and plain:find(q, 1, true)
        if not s then return "", "" end
        local function cut(str, fromEnd)
            if fromEnd then
                str = str:sub(-40)
                return (str:gsub("^[\128-\191]+", ""):gsub("^%S*%s", "", 1))
            end
            str = str:sub(1, 40)
            return (str:gsub("[\192-\255][\128-\191]*$", ""):gsub("%s%S*$", "", 1))
        end
        return cut(plain:sub(1, s - 1), true), cut(plain:sub(s + #q), false)
    end
    function self.isoNow()
        local ms = self.now()
        return os.date("!%Y-%m-%dT%H:%M:%S", math.floor(ms / 1000)) .. string.format(".%03dZ", ms % 1000)
    end
    function self.newId(prefix)
        return (prefix or "ko") .. "_" .. string.format("%x", self.now()) .. "_" .. crypto.toHex(crypto.randomBytes(3))
    end

    --[[--
    Starts over on this reader: the files this plugin made (removeFile drops KOReader's sidecar too), their images and
    every record kept here go; the device id stays. The caller sends what is unsent first: changes not sent are lost.
    ]]
    function self.reset(removeFile)
        for id, st in pairs(self.state) do
            if fs.exists(st.file) then removeFile(st.file) end
            local safe = tostring(id):gsub("[^%w%-_]", "_")
            for k = 1, (st.imgs or 0) do for _, ext in ipairs({ "jpg", "png", "gif", "webp", "svg" }) do fs.remove(self.outDir .. "/" .. M.IMAGE_DIR .. "/" .. safe .. "-" .. k .. "." .. ext) end end
        end
        for key in pairs(self.index) do fs.remove(recPath(key)) end
        self.index, self.ledger, self.links, self.state = {}, { items = {} }, {}, {}
        gathered = nil; unsaved = false
        writeJson(self.dataDir .. "/files.json", self.state)
        save()
    end

    --- Every file this plugin made (for "Remove downloaded articles").
    function self.files()
        local out = {}
        for _, st in pairs(self.state) do out[#out + 1] = st.file end
        return out
    end
    function self.forgetFiles()
        self.state = {}
        writeJson(self.dataDir .. "/files.json", self.state)
    end
    return self
end

return M
