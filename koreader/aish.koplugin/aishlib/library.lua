--[[--
Read-only sync of one encrypted AISH place into a folder of HTML files.

  pull()        every record file whose ETag changed is downloaded, decrypted and checked, and kept on this device
                (one JSON file per record; a lean index lists them). Nothing is ever written to the server.
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

local M = {}
local TYPES = { article = true, hl = true, coll = true, note = true }
local KEY_RX = "^(%a+):([%w_%.:%-]+)$"
M.RECORD_DIR = "r"

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

    function self.record(key) return readJson(recPath(key)) end
    local function save()
        writeJson(self.dataDir .. "/index.json", self.index)
        writeJson(self.dataDir .. "/ledger.json", self.ledger)
    end

    --- Starts over when the place on the server was made anew (another salt): the old records belong to another library.
    function self.resetIfNewPlace(salt)
        if self.ledger.salt and self.ledger.salt ~= salt then
            for key in pairs(self.index) do fs.remove(recPath(key)) end
            self.index, self.ledger = {}, { items = {} }
        end
        self.ledger.salt = salt
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
                    local cur = self.index[rec.key]
                    local t = tonumber(rec.rev.t) or 0
                    -- the server is the truth for a reader; an older copy (a stale cache on the server) never replaces a newer one
                    if not cur or (cur.t or 0) <= t then
                        fs.write(recPath(rec.key), text)
                        self.index[rec.key] = { t = t, deleted = rec.deleted == true or nil, type = typ }
                        res.changed[rec.key] = true
                    end
                    self.ledger.items[e.name] = e.etag
                    res.fetched = res.fetched + 1
                end
            end
            if reason and reason ~= "gone" then res.failed[#res.failed + 1] = { name = e.name, reason = reason } end
            if i % 25 == 0 then save() end   -- a long first run keeps what it has if it stops
        end
        save()
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
        return hlByPage, notesByPage, notesByHl, collsOf
    end

    local function digest(parts) return crypto.toHex(crypto.hmac("aish-koreader", table.concat(parts, "\0"))):sub(1, 24) end

    --[[--
    Writes the HTML files. → { written = { path }, removed = { path }, collections = { [path] = { names } }, skipped }
    removeFile(path) is called for a file to remove (the plugin also drops KOReader's sidecar there).
    ]]
    function self.materialize(removeFile)
        fs.mkdirp(self.outDir)
        local hlByPage, notesByPage, notesByHl, collsOf = gather()
        local res = { written = {}, removed = {}, collections = {}, skipped = 0, articles = 0 }
        local used = {}
        for _, st in pairs(self.state) do used[st.file] = true end
        for key, e in pairs(self.index) do
            local typ, id = key:match(KEY_RX)
            if typ == "article" then
                local st = self.state[id]
                local rec = not e.deleted and live(key)
                local v = rec and rec.values
                local skip = not v or json.val(v.feedStub) or json.val(v.savedOnly)
                    or not ((type(v.content) == "string" and v.content:match("%S")) or (type(v.summaryBase) == "string" and v.summaryBase:match("%S")) or (type(v.summary) == "string" and v.summary:match("%S")))
                if skip then
                    if e.deleted and st then   -- deleted in AISH: remove what this plugin made
                        if fs.exists(st.file) then removeFile(st.file) end
                        res.removed[#res.removed + 1] = st.file
                        used[st.file] = nil; self.state[id] = nil
                    elseif not e.deleted then res.skipped = res.skipped + 1 end
                else
                    res.articles = res.articles + 1
                    local pages = { looseKey(v.url) }
                    if type(v.feedUrl) == "string" and v.feedUrl ~= "" then pages[#pages + 1] = looseKey(v.feedUrl) end
                    local hls, notes, seenHl = {}, {}, {}
                    for _, pk in ipairs(pages) do
                        for _, h in ipairs(hlByPage[pk] or {}) do
                            if not seenHl[h.id] then seenHl[h.id] = true; hls[#hls + 1] = h end
                        end
                        for _, n in ipairs(notesByPage[pk] or {}) do notes[#notes + 1] = n end
                    end
                    for _, h in ipairs(hls) do for _, n in ipairs(notesByHl[h.id] or {}) do notes[#notes + 1] = n end end
                    local parts = { tostring(rec.rev.t), tostring(e.t) }
                    for _, h in ipairs(hls) do parts[#parts + 1] = h.id .. ":" .. tostring(h.t) .. ":" .. tostring(h.dismissed) end
                    for _, n in ipairs(notes) do parts[#parts + 1] = n.id .. ":" .. n.text end
                    local sig = digest(parts)
                    local file = st and st.file
                    if not file then
                        local name = render.fileName(json.val(v.title), id)
                        file = self.outDir .. "/" .. name
                        local k = 2
                        while used[file] or fs.exists(file) do file = self.outDir .. "/" .. name:gsub("%.html$", " " .. k .. ".html"); k = k + 1 end
                    end
                    if not (st and st.sig == sig and fs.exists(file)) then
                        local vals = {}
                        for f, x in pairs(v) do vals[f] = json.val(x) end
                        fs.write(file, render.article(vals, hls, notes, self.labels))
                        res.written[#res.written + 1] = file
                    end
                    used[file] = true
                    self.state[id] = { file = file, sig = sig }
                    if collsOf[id] then res.collections[file] = collsOf[id] end
                end
            end
        end
        writeJson(self.dataDir .. "/files.json", self.state)
        return res
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
