-- Run by interop.sh (skipped otherwise): main.lua inside a stand-in for KOReader's modules.
--   phase "plugin":  connect with a code file, sync (the place as the interop test left it: 2 articles, one in "Exam prep"),
--                    collections, the kept key; then open an article: AISH highlights become KOReader highlights, one made
--                    on the reader and note edits go back, closing sends them.
--   phase "plugin2": after the browser changed things (browser-step.mjs edit): a sync brings them into the closed book.
--   phase "plugin3": security: PIN seal (restart, wrong PIN, right PIN), the reader's own Nextcloud login by QR code, and
--                    "Wipe device" in Nextcloud deleting the library from the reader.
local phase = os.getenv("AISH_PHASE")
if phase ~= "plugin" and phase ~= "plugin2" and phase ~= "plugin3" then return end
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
package.path = here .. "/../aish.koplugin/?.lua;" .. here .. "/?.lua;" .. package.path
local fsu = require("fsutil")
local json = require("aishlib.json")
local work = os.getenv("AISH_WORK") .. "-plugin"
local home = work .. "/home"
fsu.mkdirp(home); fsu.mkdirp(work .. "/settings"); fsu.mkdirp(work .. "/data")

local shown, flushed = {}, {}
local function mod(name, v) package.loaded[name] = v end
local function widget(kind) return { new = function(_, o) o = o or {}; o.kind = kind; o.onShowKeyboard = function() end; return o end } end
-- settings and sidecars are kept in JSON files between the two phases (KOReader keeps them on disk too)
local function persisted(file)
    local data = json.decode(fsu.read(file) or "{}") or {}
    return data, function() fsu.write(file, json.encode(data)) end
end
local settingsStore, saveSettings = persisted(work .. "/settings.json")
local LuaSettings = { open = function(_, path)
    settingsStore[path] = settingsStore[path] or {}
    local data = settingsStore[path]
    return { data = data, readSetting = function(_, k) return json.val(data[k]) end, saveSetting = function(_, k, v) data[k] = v; saveSettings() end,
        delSetting = function(_, k) data[k] = nil; saveSettings() end, flush = function() flushed[path] = true; saveSettings() end,
        isTrue = function(_, k) return data[k] == true end, flipNilOrTrue = function(_, k) if data[k] == nil or data[k] == true then data[k] = false else data[k] = nil end end, nilOrTrue = function(_, k) return data[k] == nil or data[k] == true end }
end }
local sidecars, saveSidecars = persisted(work .. "/sidecars.json")
_G.G_reader_settings = LuaSettings:open("global"); G_reader_settings:saveSetting("home_dir", home .. "/")   -- as KOReader may keep it: a trailing slash
mod("datastorage", { getSettingsDir = function() return work .. "/settings" end, getDataDir = function() return work .. "/data" end })
mod("dispatcher", { registerAction = function() end })
mod("docsettings", { updateLocation = function() end,
    hasSidecarFile = function(_, f) return sidecars[f] ~= nil end, findSidecarFile = function() return nil end,
    open = function(_, f) sidecars[f] = sidecars[f] or {}; local d = sidecars[f]
        return { readSetting = function(_, k) return d[k] end, saveSetting = function(_, k, v) d[k] = v end, flush = saveSidecars } end })
mod("ui/event", { new = function(_, name, args) return { name = name, args = args } end })
mod("ui/widget/infomessage", widget("info")); mod("ui/widget/inputdialog", widget("input")); mod("ui/widget/confirmbox", widget("confirm"))
mod("ui/widget/multiinputdialog", widget("multi")); mod("luasettings", LuaSettings); mod("ui/widget/qrmessage", widget("qr"))
-- pressing a button of the last dialog that has it, with what was typed
local function press(label, input)
    for i = #shown, 1, -1 do
        local d = shown[i]
        if d.ok_text == label then table.remove(shown, i); return d.ok_callback() end
        for _, row in ipairs(d.buttons or {}) do
            for _, b in ipairs(row) do
                if b.text == label then
                    if type(input) == "table" then d.getFields = function() return input end else d.getInputText = function() return input end end
                    table.remove(shown, i)
                    return b.callback()
                end
            end
        end
    end
    error("no button " .. label)
end
mod("ui/network/manager", { runWhenOnline = function(_, cb) cb() end, isOnline = function() return true end })
mod("ui/uimanager", { show = function(_, w) shown[#shown + 1] = w end, close = function() end, forceRePaint = function() end,
    nextTick = function(_, cb) cb() end, scheduleIn = function(_, _t, cb) cb() end, setDirty = function() end })
mod("ui/widget/container/widgetcontainer", { extend = function(_, o) o.__index = o; return setmetatable(o, {}) end })
mod("ffi/util", { template = function(s, ...) local a = { ... }; return (s:gsub("%%(%d)", function(i) return tostring(a[tonumber(i)]) end)) end,
    realpath = function(p) return p end, purgeDir = function(d) os.execute("rm -rf '" .. d .. "'") end })
mod("libs/libkoreader-lfs", { attributes = function(p, what)
    if what == "modification" then return fsu.mtime(p) end
    if fsu.exists(p) then return "file" end
    return os.execute("test -d '" .. p .. "'") == 0 and "directory" or nil end,
    touch = function(p, _, m) fsu.touch(p, m) end,
    dir = function(d) local l = fsu.ls(d); local i = 0; return function() i = i + 1; return l[i] end end })
local opened = {}
mod("apps/reader/readerui", { showReader = function(_, f) opened[#opened + 1] = f end })
mod("logger", { info = function() end, warn = print, err = print, dbg = function() end })
mod("socketutil", { set_timeout = function() end, reset_timeout = function() end, FILE_BLOCK_TIMEOUT = 15, FILE_TOTAL_TIMEOUT = 60 })
mod("util", { makePath = fsu.mkdirp, trim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end })
mod("gettext", function(s) return s end)
local RC = { coll = {}, writes = 0 }
function RC:addCollection(n) self.coll[n] = {} end
function RC:addItemsMultiple(files, colls) local c = 0; for f in pairs(files) do for n in pairs(colls) do if not self.coll[n][f] then self.coll[n][f] = { file = f, order = 999 }; c = c + 1 end end end return c end
function RC:write() self.writes = self.writes + 1 end
function RC:removeItem() end
function RC:removeCollection(n) self.coll[n] = nil end
function RC:getOrderedCollection(n) local l = {}; for _, it in pairs(self.coll[n]) do l[#l + 1] = it end; table.sort(l, function(a, b) return (a.order or 0) < (b.order or 0) end); return l end
mod("readcollection", RC); mod("readhistory", { fileDeleted = function() end })
mod("apps/filemanager/filemanager", { instance = nil }); mod("apps/filemanager/filemanagerutil", { getDefaultDir = function() return home end })

local AISH = require("main")
local menu = {}
local plugin = setmetatable({ ui = { menu = { registerToMainMenu = function(_, p) p:addToMainMenu(menu) end } } }, { __index = AISH })
plugin:init()
local sleepFile = home .. "/AISH/Why we sleep what the new studies show [ka1].epub"
local function unzipText(file, member)
    local h = io.popen("unzip -p '" .. file .. "' '" .. member .. "' 2>/dev/null"); local t = h:read("*a"); h:close(); return t
end

-- a stand-in for an open book: KOReader's search over the file's text, its annotation list
local marks = require("aishlib.marks")
local function openBook(file, annotations)
    local _, plain = marks._index(unzipText(file, "OEBPS/article.xhtml"))
    local ann = { annotations = annotations or {} }
    function ann:addItem(it) self.annotations[#self.annotations + 1] = it; return #self.annotations end
    local events = {}
    local ds = {}
    local docSettings = { readSetting = function(_, k) return ds[k] end, hasNot = function(_, k) return ds[k] == nil end, makeTrue = function(_, k) ds[k] = true end, data = ds }
    local ui = { annotation = ann, doc_settings = docSettings, toc = { getTocTitleByPage = function() return "Chapter" end, resetToc = function() end, fillToc = function() end }, view = { highlight = { saved_color = "yellow" } },
        handleEvent = function(_, e) events[#events + 1] = e end, dialog = {}, menu = plugin.ui.menu, events = events }
    ui.document = { file = file, canHaveAlternativeToc = function() return true end,
        findAllText = function(_, pat)
            local out, from = {}, 1
            while true do
                local s = plain:find(marks.norm(pat), from, true)
                if not s then break end
                out[#out + 1] = { start = "xp:" .. s, ["end"] = "xp:" .. (s + #pat), prev_text = plain:sub(math.max(1, s - 30), s - 1), next_text = plain:sub(s + #pat, s + #pat + 30) }
                from = s + 1
            end
            return out
        end,
        compareXPointers = function(_, a, b) local x, y = tonumber(a:match("%d+")), tonumber(b:match("%d+")); return x < y and 1 or (x > y and -1 or 0) end }
    plugin.ui = ui
    return ui
end
local function closeBook(ui)
    plugin:onCloseDocument()
    sidecars[ui.document.file] = { annotations = ui.annotation.annotations }; saveSidecars()   -- KOReader saves the book's settings
    plugin.ui = { menu = ui.menu }
end

if phase == "plugin3" then
    local Real = require("aishlib.nc")
    local fakeCalls = {}
    package.loaded["aishlib.nc"] = { serverOf = Real.serverOf, normalizeServer = Real.normalizeServer, new = function()
        local polls = 0
        return {
            startLogin = function(server) fakeCalls[#fakeCalls + 1] = "start " .. server; return { login = server .. "/login/v2/flow/x", token = "T", endpoint = server .. "/login/v2/poll" } end,
            poll = function() polls = polls + 1; if polls == 1 then return false end
                return { server = os.getenv("AISH_URL"):gsub("/$", ""), loginName = "phil", appPassword = "app pass/ü" } end,
            wipeRequested = function(server, pw) fakeCalls[#fakeCalls + 1] = "wipe? " .. pw; return true end,
            wipeDone = function(server, pw) fakeCalls[#fakeCalls + 1] = "wiped " .. pw end,
            revoke = function() fakeCalls[#fakeCalls + 1] = "revoke" end,
        } end }
    local settingsFile = work .. "/settings/aish.lua"
    -- PIN on
    shown = {}
    plugin:togglePin()
    press("OK", "123456"); press("OK", "123456")
    local st = settingsStore[settingsFile]
    assert(st.sealed and not st.master and not st.connection.password, "sealed; nothing in the clear")
    assert(not fsu.read(work .. "/settings.json"):find("app pass", 1, true), "the password is not in the settings file")
    -- a restart: locked; a wrong PIN, then the right one
    for k in pairs(AISH._shared) do AISH._shared[k] = nil end
    local fresh = setmetatable({ ui = { menu = plugin.ui.menu } }, { __index = AISH }); fresh:init()
    assert(fresh:isLocked())
    shown = {}
    fresh:syncNow(); press("Unlock", "000000")
    assert(shown[#shown].text == "Wrong PIN." and fresh:isLocked())
    fresh:syncNow(); press("Unlock", "123456")
    assert(shown[#shown].text and shown[#shown].text:find("AISH library: 2 articles", 1, true), "synced after the PIN: " .. tostring(shown[#shown].text))
    -- the reader's own Nextcloud login by QR code (the PIN stays on: the new login is sealed too)
    shown = {}
    fresh:connectWithNextcloud()
    press("Show QR code", { "127.0.0.1:8766", "My Library" })
    local qr; for _, w in ipairs(shown) do if w.kind == "qr" then qr = w end end
    assert(qr and qr.text == "https://127.0.0.1:8766/login/v2/flow/x", "QR code with the login address")
    local c = settingsStore[settingsFile].connection
    assert(c.flow and c.username == "phil" and c.url == os.getenv("AISH_URL") .. "remote.php/dav/files/phil/" and not c.password, "connected with its own login: " .. tostring(c.url))
    assert(settingsStore[settingsFile].sealed and AISH._shared.secrets.password == "app pass/ü", "the new login sealed with the PIN")
    press("Unlock", "orbit lemon tunnel paper river cloud")   -- the library key was for the old connection: the passphrase once
    assert(shown[#shown].text:find("AISH library: 2 articles", 1, true), "synced through the new login: " .. tostring(shown[#shown].text))
    -- lost: "Wipe device" in Nextcloud. The server refuses the login; the reader asks, deletes everything, confirms
    AISH._shared.secrets.password = "revoked"
    shown = {}
    fresh:syncNow()
    assert(fakeCalls[#fakeCalls - 1] == "wipe? revoked" and fakeCalls[#fakeCalls] == "wiped revoked", table.concat(fakeCalls, ", "))
    assert(#fsu.ls(home .. "/AISH") == 0, "articles deleted")
    st = settingsStore[settingsFile]
    assert(not st.connection and not st.sealed and not st.master and not AISH._shared.secrets, "login, key and seal deleted")
    assert(not fsu.exists(work .. "/data/aish/index.json"), "library data deleted")
    assert(shown[#shown].text:find("Wipe device", 1, true))
    print("TEST plugin3 OK")
    os.exit(0)
end

if phase == "plugin2" then
    -- the browser edited the comment on the reader's highlight and deleted h-3; the book is closed and was finished
    sidecars[sleepFile].summary = { status = "complete" }; saveSidecars()
    shown = {}
    plugin:syncNow()
    assert(shown[#shown].text:find("AISH library: 2 articles", 1, true), shown[#shown].text)
    local items = sidecars[sleepFile].annotations
    local ko, h3
    for _, it in ipairs(items) do
        if it.text == "Short naps of about twenty minutes" then ko = it end
        if it.aish_id == "h-3" then h3 = it end
    end
    assert(ko and ko.note == "Edited in the browser.", "comment edited in the browser → note in the closed book: " .. tostring(ko and ko.note))
    assert(not h3, "highlight deleted in the browser → gone from the book")
    local RCo = require("readcollection")
    local arch = {}; for f in pairs(RCo.coll["AISH · Archive"] or {}) do arch[#arch + 1] = f end
    assert(#arch == 1 and arch[1]:find("Why we sleep", 1, true), "finished in KOReader → archived in AISH")
    -- a new layout (render version) reaches the articles already on the reader
    local L = require("aishlib.library")
    local was = L.RENDER_VERSION
    L.RENDER_VERSION = was .. "-next"
    shown = {}
    plugin:syncNow()
    assert(shown[#shown].text:find("2 files written", 1, true), "every file rewritten for the new layout: " .. shown[#shown].text)
    L.RENDER_VERSION = was
    -- "Download everything again": a highlight made on the reader is sent first, the files and records go, everything
    -- comes back; the highlight is back in the book on opening
    sidecars[sleepFile].annotations[#sidecars[sleepFile].annotations + 1] = { text = "the connections between neurons", drawer = "lighten", pos0 = "xp:9", pos1 = "xp:10", page = "xp:9" }
    saveSidecars()
    local before = fsu.read(work .. "/data/aish/index.json")
    -- covers: drawn once, then taken from the cache (a stand-in for KOReader's drawing)
    local drawn = 0
    plugin.drawCover = function(_, info, dir, path)
        drawn = drawn + 1; fsu.mkdirp(dir)
        fsu.write(path, "\255\216\255\224" .. info.title); return fsu.read(path)
    end
    shown = {}
    plugin:downloadAgain(); press("Download again")
    assert(shown[#shown].text:find("AISH library: 2 articles.\n%d+ downloaded, 2 files written"), "downloaded again: " .. tostring(shown[#shown].text))
    local lib = plugin:library()
    local hls = lib.highlightsOf("k-a1")
    local found = false
    for __, h in ipairs(hls) do if h.text == "the connections between neurons" then found = true end end
    assert(found, "the reader's new highlight was sent before starting over, and came back")
    assert(fsu.read(work .. "/data/aish/index.json") ~= before and lib.pendingCount() == 0)
    assert(drawn == 2, "a cover drawn per article: " .. drawn)
    assert(unzipText(sleepFile, "OEBPS/content.opf"):find('href="images/cover.jpg"', 1, true), "the drawn cover is in the EPUB")
    shown = {}
    plugin:downloadAgain(); press("Download again")
    assert(drawn == 2, "downloaded again: the covers come from the cache, nothing is drawn")
    assert(#fsu.ls(work .. "/data/aish-covers") == 2, "the cache holds the covers in use")
    print("TEST plugin2 OK")
    os.exit(0)
end
assert(menu.aish_library and #menu.aish_library.sub_item_table == 18, "menu")
assert(menu.aish_library.sub_item_table[5].text_func() == "Not connected")

local function enc(s) return (s:gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end)) end
fsu.write(home .. "/aish-library.txt", "Here is my code:\naish-library://v1?k=webdav&u=" .. enc(os.getenv("AISH_URL")) .. "&n=phil&p=" .. enc("app pass/ü") .. "&r=" .. enc("My Library") .. "&w=" .. enc("orbit lemon tunnel paper river cloud") .. "\n")
plugin:connectWithCode()
assert(not fsu.exists(home .. "/aish-library.txt"), "the code file (it holds the login) is removed after reading")
local last = shown[#shown]
assert(last.kind == "info" and last.text:find("AISH library: 2 articles", 1, true), "sync result: " .. tostring(last.text))
local files = fsu.ls(home .. "/AISH")
assert(#files == 2, "2 files in the AISH folder of the home folder: " .. table.concat(files, ", "))
local exam = RC.coll["AISH: Exam prep"]
local n = 0; for _ in pairs(exam or {}) do n = n + 1 end
assert(n == 1 and RC.writes == 1, "KOReader collection AISH: Exam prep with its file")
-- the AISH tabs as collections, newest first; the top tags; file dates = saved dates; images as files
local function ordered(name) local out = {}; for _, it in ipairs(RC:getOrderedCollection(name)) do out[#out + 1] = it.file:match("[^/]+$") end return table.concat(out, " | ") end
assert(ordered("AISH · Inbox") == "Only a summary here (renamed) [ka3].epub | Why we sleep what the new studies show [ka1].epub", "Inbox newest first: " .. ordered("AISH · Inbox"))
assert(ordered("AISH · Read") == "" and ordered("AISH · Archive") == "", "nothing read or archived yet")
assert(ordered("AISH #science") == "Why we sleep what the new studies show [ka1].epub", "tag collection")
assert(fsu.mtime(sleepFile) == require("aishlib.library").isoToEpoch("2026-11-02T08:00:00.000Z"), "the file's date is the day it was saved")
-- the EPUB: text with the image inside, book information, table of contents
local xhtml, opf, nav = unzipText(sleepFile, "OEBPS/article.xhtml"), unzipText(sleepFile, "OEBPS/content.opf"), unzipText(sleepFile, "OEBPS/nav.xhtml")
assert(xhtml:find('<img src="images/1.png" alt="A tiny chart"/>', 1, true) and unzipText(sleepFile, "OEBPS/images/1.png"):sub(2, 4) == "PNG", "image inside the EPUB")
assert(not opf:find("cover-image", 1, true), "a 1-pixel image is never the cover (and KOReader's drawing is not available here)")
assert(opf:find("<dc:title>Why we sleep: what the new studies show</dc:title>", 1, true) and opf:find("<dc:publisher>science.example</dc:publisher>", 1, true), "title, site")
assert(opf:find("<dc:subject>science</dc:subject>", 1, true) and opf:find("<dc:date>2026-11-02</dc:date>", 1, true), "tags, date saved")
assert(opf:find("<dc:description>• Sleep consolidates memory.</dc:description>", 1, true), "summary as description")
assert(opf:find('<meta name="calibre:series" content="Exam prep"/>', 1, true), "AISH collection as series")
assert(nav:find(">Summary</a>", 1, true) and not fsu.exists(home .. "/AISH/.images"), "table of contents; no loose image files")
-- gesture: the newest unread article opens
plugin:onAishOpenNewest()
assert(opened[#opened] and opened[#opened]:find("Only a summary here", 1, true), "newest unread opened")
local s = settingsStore[work .. "/settings/aish.lua"]
assert(s.master and #s.master == 64 and s.salt and not s.passphrase, "the key is kept, the passphrase is not")
assert(menu.aish_library.sub_item_table[5].text_func():find("2 articles"), "status line")

-- second sync: the kept key opens the place (no passphrase), nothing new
shown = {}
plugin:syncNow()
assert(shown[#shown].text:find("0 downloaded, 0 files written, 0 removed", 1, true), shown[#shown].text)
for _, w in ipairs(shown) do assert(w.kind ~= "input", "no passphrase asked") end

-- a wrong kept key (place made anew elsewhere) asks for the passphrase instead of failing
local master_ok = s.master
s.master = string.rep("00", 32)
shown = {}
plugin:syncNow()
local asked = false
for _, w in ipairs(shown) do if w.kind == "input" and w.title:find("Passphrase") then asked = true end end
assert(asked, "asks for the passphrase when the kept key no longer opens the place")

-- stage 2: open the sleep article
s.master = master_ok
local ui = openBook(sleepFile)
plugin:onReaderReady()
local items = ui.annotation.annotations
local by = {}
for _, it in ipairs(items) do by[it.aish_id] = it end
assert(#items == 3 and by["h-1"] and by["h-2"] and by["h-3"], "the 3 AISH highlights became KOReader highlights: " .. #items)
assert(by["h-1"].note == "Matches chapter 3 of the textbook." and by["h-1"].drawer == "lighten" and by["h-1"].color == "yellow", "comment as note")
assert(by["h-2"].drawer == "underscore" and by["h-1"].chapter == "Chapter", "AI one underlined")
assert(#ui.events == 1 and ui.events[1].name == "AnnotationsModified", "KOReader told once")
assert(ui.doc_settings.data.alternative_toc == nil, "an EPUB brings its own table of contents")
-- the reader: a new highlight with a note, the comment on h-1 edited, the AI highlight removed
items[#items + 1] = { text = "Short naps of about twenty minutes", drawer = "lighten", pos0 = "xp:1", pos1 = "xp:2", page = "xp:1", note = "Try it this week." }
plugin:onAnnotationsModified()
assert(items[#items].aish_id and items[#items].aish_id:match("^ko_"), "linked right away (saved with the book)")
by["h-1"].note = "Matches chapter 3 - and chapter 5."
for i = #items, 1, -1 do if items[i].aish_id == "h-2" then table.remove(items, i) end end
plugin:onAnnotationsModified()
shown = {}
closeBook(ui)   -- online: sent right away, quietly
for _, w in ipairs(shown) do assert(w.kind ~= "info" or not w.text:find("failed"), "no error: " .. tostring(w.text)) end
assert(settingsStore[work .. "/settings/aish.lua"].last_sync.pending == 0, "everything sent")
assert(ordered("AISH · Read") == "Why we sleep what the new studies show [ka1].epub" and ordered("AISH · Inbox") == "Only a summary here (renamed) [ka3].epub", "opened → Read: " .. ordered("AISH · Read"))
-- Wi-Fi comes on: a sync when one is due, not before
local before = settingsStore[work .. "/settings/aish.lua"].last_sync.time
plugin:onNetworkConnected()
assert(settingsStore[work .. "/settings/aish.lua"].last_sync.time == before, "not due yet")
settingsStore[work .. "/settings/aish.lua"].last_sync.time = 0
shown = {}
plugin:onNetworkConnected()
assert(settingsStore[work .. "/settings/aish.lua"].last_sync.time > 0, "synced")
for _, w in ipairs(shown) do assert(w.kind ~= "info", "quietly: " .. tostring(w.text)) end
print("TEST plugin OK")
