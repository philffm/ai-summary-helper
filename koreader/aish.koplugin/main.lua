--[[--
AISH library for KOReader.

Connects to the encrypted sync place of the AISH browser extension (a folder on your Nextcloud/WebDAV server), decrypts it
on the reader and keeps a folder of HTML files: per article the AI summary, the full text and your notes. AISH collections
become KOReader collections ("AISH: <name>").

Highlights are KOReader's own: AISH highlights appear as KOReader highlights when an article is opened (AI ones underlined,
comments as notes), and highlights and notes made on the reader go back to AISH, like deleting one and opening an article
(it counts as read). Changes made on the reader are sent at the next sync, and when an AISH article is closed while online.

The passphrase is not kept: the key made from it is (like the extension's background worker does), so later syncs do not
spend seconds on key derivation. "Disconnect" forgets the login and the key.

@module koplugin.aish
]]
local DataStorage = require("datastorage")
local Dispatcher = require("dispatcher")
local DocSettings = require("docsettings")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local ConfirmBox = require("ui/widget/confirmbox")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local ffiUtil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local socketutil = require("socketutil")
local util = require("util")
local _ = require("gettext")
local T = ffiUtil.template

local COLL_PREFIX = "AISH: "
local CODE_FILE = "aish-library.txt"

local fs = {
    mkdirp = function(p) util.makePath(p) end,
    exists = function(p) return lfs.attributes(p, "mode") == "file" end,
    read = function(p)
        local f = io.open(p, "rb"); if not f then return nil end
        local s = f:read("*a"); f:close(); return s
    end,
    write = function(p, s)   -- a new file first, then the rename: a reader switched off mid-write keeps the old file
        local f = assert(io.open(p .. ".part", "wb")); f:write(s); f:close()
        assert(os.rename(p .. ".part", p))
    end,
    remove = function(p) os.remove(p) end,
}

local AISH = WidgetContainer:extend{
    name = "aish",
    is_doc_only = false,
}

function AISH:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/aish.lua")
    self.data_dir = DataStorage:getDataDir() .. "/aish"
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function AISH:onDispatcherRegisterActions()
    Dispatcher:registerAction("aish_sync", { category = "none", event = "AishSync", title = _("AISH: sync library"), general = true })
end

-- ── settings ────────────────────────────────────────────────────────────────
function AISH:conn() return self.settings:readSetting("connection") end
function AISH:isConnected() local c = self:conn(); return c and c.url and c.url ~= "" end
function AISH:outDir()
    local d = self.settings:readSetting("folder")
    if d and d ~= "" then return d end
    local home = G_reader_settings:readSetting("home_dir") or require("apps/filemanager/filemanagerutil").getDefaultDir()
    return (home or DataStorage:getDataDir()) .. "/AISH"
end
function AISH:save() self.settings:flush() end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

-- ── menu ────────────────────────────────────────────────────────────────────
function AISH:addToMainMenu(menu_items)
    menu_items.aish_library = {
        text = _("AISH library"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Sync now"),
                enabled_func = function() return self:isConnected() end,
                callback = function() self:syncNow() end,
            },
            {
                text = _("Go to AISH folder"),
                enabled_func = function() return lfs.attributes(self:outDir(), "mode") == "directory" end,
                callback = function() self:goToFolder() end,
            },
            {
                text_func = function()
                    local last = self.settings:readSetting("last_sync")
                    if not self:isConnected() then return _("Not connected") end
                    if not last then return _("Not synced yet") end
                    local text = T(_("Last sync: %1 · %2 articles"), os.date("%Y-%m-%d %H:%M", last.time), last.articles or 0)
                    if (last.pending or 0) > 0 then text = text .. " · " .. T(_("%1 not sent"), last.pending) end
                    return text
                end,
                enabled = false,
                separator = true,
            },
            {
                text = _("Connect with a code"),
                help_text = T(_([[In the AISH extension: Settings → Sync & backup → your encrypted place → "Show code for the phone" → "Save code as file (KOReader)".

Copy the file %1 into KOReader's home folder (over USB), or paste the code (aish-library://…) here. The file is deleted after it was read: it holds your login.]]), CODE_FILE),
                keep_menu_open = true,
                callback = function(touchmenu) self:connectWithCode(touchmenu) end,
            },
            {
                text = _("Connect manually"),
                keep_menu_open = true,
                callback = function(touchmenu) self:connectManually(touchmenu) end,
            },
            {
                text_func = function() return T(_("Folder: %1"), self:outDir()) end,
                keep_menu_open = true,
                callback = function(touchmenu)
                    require("ui/downloadmgr"):new{
                        onConfirm = function(path)
                            self.settings:saveSetting("folder", path .. "/AISH"); self:save()
                            if touchmenu then touchmenu:updateItems() end
                        end,
                    }:chooseDir()
                end,
            },
            {
                text = _("Send changes when closing an article"),
                help_text = _("Highlights, notes and read marks made on the reader go to AISH as soon as you close the article, when Wi-Fi is on. Otherwise they go at the next sync."),
                checked_func = function() return self.settings:nilOrTrue("send_on_close") end,
                callback = function() self.settings:flipNilOrTrue("send_on_close"); self:save() end,
            },
            {
                text = _("Disconnect"),
                enabled_func = function() return self:isConnected() end,
                keep_menu_open = true,
                callback = function(touchmenu) self:disconnect(touchmenu) end,
            },
        },
    }
end

function AISH:goToFolder()
    local dir = self:outDir()
    if self.ui.document then self.ui:onClose() end
    local FileManager = require("apps/filemanager/filemanager")
    if FileManager.instance then FileManager.instance:reinit(dir) else FileManager:showFiles(dir) end
end

-- ── connecting ──────────────────────────────────────────────────────────────
function AISH:applyCode(text, touchmenu)
    local Code = require("aishlib.code")
    local c = Code.parse(text)
    if not c then notify(_("This is not an AISH library code. It starts with aish-library://")); return end
    if c.kind ~= "webdav" then notify(_("This reader can only use a Nextcloud/WebDAV place for now, not S3.")); return end
    self.settings:saveSetting("connection", { url = c.url, username = c.username, password = c.password, root = c.root })
    self.settings:delSetting("master"); self.settings:delSetting("salt")
    self:save()
    if touchmenu then touchmenu:updateItems() end
    self:syncNow(c.words)
end

function AISH:connectWithCode(touchmenu)
    -- a code file put on the reader over USB wins: typing a long code on an e-ink keyboard is no fun
    local FileManagerUtil = require("apps/filemanager/filemanagerutil")
    local home = G_reader_settings:readSetting("home_dir") or FileManagerUtil.getDefaultDir()
    for _, dir in ipairs({ home, DataStorage:getDataDir(), self:outDir() }) do
        local path = dir and (dir .. "/" .. CODE_FILE)
        local text = path and fs.read(path)
        if text and text:find("aish%-library://") then
            os.remove(path)
            logger.info("AISH: read the connection code from", path, "and removed the file")
            self:applyCode(text:match("aish%-library://%S+"), touchmenu)
            return
        end
    end
    local dialog
    dialog = InputDialog:new{
        title = _("AISH library code"),
        description = T(_("Paste the code from the extension, or put it in a file named %1 in your home folder."), CODE_FILE),
        input_hint = "aish-library://v1?…",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Connect"), is_enter_default = true, callback = function()
                local text = dialog:getInputText()
                UIManager:close(dialog)
                self:applyCode(text, touchmenu)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:connectManually(touchmenu)
    local c = self:conn() or {}
    local dialog
    dialog = MultiInputDialog:new{
        title = _("AISH library on Nextcloud/WebDAV"),
        fields = {
            { text = c.url or "", hint = _("WebDAV address, e.g. https://cloud.example.com/remote.php/dav/files/you/") },
            { text = c.username or "", hint = _("User") },
            { text = c.password or "", text_type = "password", hint = _("App password") },
            { text = c.root or "aish-sync", hint = _("Folder of the AISH place") },
        },
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Save and sync"), callback = function()
                local f = dialog:getFields()
                UIManager:close(dialog)
                if not f[1]:match("^https?://") then notify(_("The address must start with https://")); return end
                self.settings:saveSetting("connection", { url = util.trim(f[1]), username = util.trim(f[2]), password = f[3], root = util.trim(f[4]) ~= "" and util.trim(f[4]) or "aish-sync" })
                self.settings:delSetting("master"); self.settings:delSetting("salt")
                self:save()
                if touchmenu then touchmenu:updateItems() end
                self:syncNow()
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:disconnect(touchmenu)
    UIManager:show(ConfirmBox:new{
        text = _("Forget the login and the key of the AISH library on this reader?\n\nThe downloaded articles stay in the AISH folder; delete it in the file browser if you no longer want them."),
        ok_text = _("Disconnect"),
        ok_callback = function()
            for _, k in ipairs({ "connection", "master", "salt", "last_sync" }) do self.settings:delSetting(k) end
            self:save()
            ffiUtil.purgeDir(self.data_dir)
            if touchmenu then touchmenu:updateItems() end
            notify(_("Disconnected."), 2)
        end,
    })
end

-- ── syncing ─────────────────────────────────────────────────────────────────
function AISH:onAishSync() self:syncNow(); return true end

function AISH:syncNow(words)
    if not self:isConnected() then notify(_("Connect the AISH library first (Tools → AISH library).")); return end
    if self.syncing then return end
    NetworkMgr:runWhenOnline(function() self:sync(words) end)
end

function AISH:progress(text)
    if self.quiet then return end
    if self.progress_msg then UIManager:close(self.progress_msg) end
    self.progress_msg = InfoMessage:new{ text = text, dismissable = false }
    UIManager:show(self.progress_msg)
    UIManager:forceRePaint()
end
function AISH:endProgress()
    if self.progress_msg then UIManager:close(self.progress_msg); self.progress_msg = nil end
    self.syncing = false
end
function AISH:fail(text)
    self:endProgress()
    if self.quiet then logger.warn("AISH: quiet sync failed:", text); self.quiet = false; return end
    UIManager:show(InfoMessage:new{ text = text, icon = "notice-warning" })
end

function AISH:library(store)
    return require("aishlib.library").new({
        store = store, fs = fs, dataDir = self.data_dir, outDir = self:outDir(),
        labels = { summary = _("Summary"), notes = _("Notes"), noText = _("The full text of this article was not saved in AISH.") },
    })
end

function AISH:makeStore()
    local c = self:conn()
    return require("aishlib.webdav").new({
        url = c.url, root = c.root, username = c.username, password = c.password, http = require("socket.http"),
        beforeRequest = function() socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT) end,
        afterRequest = function() socketutil:reset_timeout() end,
    })
end

--- The keys for `meta`: the kept key when it still opens the place, else the passphrase (from the code, or asked for).
function AISH:withKeys(meta, words, cont)
    local C, Code = require("aishlib.crypto"), require("aishlib.code")
    local master = self.settings:readSetting("master")
    if master and self.settings:readSetting("salt") == meta.salt then
        local keys = C.openWithMaster(meta, C.fromHex(master))
        if keys then return cont(keys) end
    end
    local function tryPassphrase(p)
        self:progress(_("Unlocking the library…"))
        UIManager:nextTick(function()
            local keys, m = C.openMeta(meta, Code.canonicalPassphrase(p))
            if not keys then
                self:endProgress()
                UIManager:show(InfoMessage:new{ text = _("This passphrase does not open the library. Use the words (or your own passphrase) you chose in the extension."), icon = "notice-warning" })
                return self:askPassphrase(tryPassphrase)
            end
            self.settings:saveSetting("master", C.toHex(m)); self.settings:saveSetting("salt", meta.salt); self:save()
            cont(keys)
        end)
    end
    if words and words ~= "" then return tryPassphrase(words) end
    self:endProgress()
    if self.quiet then self.quiet = false; return end   -- a background sync never asks: the next sync from the menu does
    self:askPassphrase(tryPassphrase)
end

function AISH:askPassphrase(onOk)
    local dialog
    dialog = InputDialog:new{
        title = _("Passphrase of the AISH library"),
        description = _("The words (or your own passphrase) you chose when you made the encrypted place in the extension. It is not saved; the key made from it is."),
        text_type = "password",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            { text = _("Unlock"), is_enter_default = true, callback = function()
                local p = dialog:getInputText()
                UIManager:close(dialog)
                self.syncing = true
                onOk(p)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:sync(words)
    self.syncing = true
    self:progress(_("Connecting to the AISH library…"))
    UIManager:nextTick(function()
        local ok, err = pcall(function()
            local json = require("aishlib.json")
            local store = self:makeStore()
            local raw, gerr = store.get("meta.json")
            if raw == false then return self:fail(_("No AISH library in this folder. Check the folder name of the place.")) end
            if not raw then return self:fail(T(_("Could not reach the library:\n%1"), gerr or "?")) end
            local meta = json.decode(raw)
            if type(meta) ~= "table" or meta.mode ~= "encrypted" then
                return self:fail(_("This folder holds a readable (not encrypted) AISH place. This plugin opens encrypted places."))
            end
            self:withKeys(meta, words, function(keys) self:pullAndWrite(store, meta, keys) end)
        end)
        if not ok then logger.err("AISH: sync failed", err); self:fail(T(_("Sync failed:\n%1"), tostring(err))) end
    end)
end

function AISH:pullAndWrite(store, meta, keys)
    local ok, err = pcall(function()
        local lib = self:library(store)
        lib.resetIfNewPlace(meta.salt)
        self:progress(_("Looking for changes…"))
        local shown = 0
        local res, perr = lib.pull(keys, function(done, todo)
            if todo > 0 and (done - shown >= 20 or done == todo) then
                shown = done
                self:progress(T(_("Downloading %1 of %2…"), done, todo))
            end
        end)
        if not res then return self:fail(T(_("Could not read the library:\n%1"), perr or "?")) end
        self:progress(_("Writing articles…"))
        local m = lib.materialize(function(path) self:removeArticle(path) end)
        self:updateCollections(m.collections, lib.files())
        -- highlights and notes of every article in KOReader ↔ AISH, then what changed here goes out
        local hl = self:reconcileAll(lib)
        local sent = { pushed = 0, failed = {} }
        if lib.pendingCount() > 0 then
            self:progress(_("Sending changes…"))
            sent = lib.push(keys)
        end
        self.settings:saveSetting("last_sync", { time = os.time(), articles = m.articles, pending = lib.pendingCount() }); self:save()
        self:endProgress()
        local FileManager = require("apps/filemanager/filemanager")
        if FileManager.instance then FileManager.instance:onRefresh() end
        if self.quiet then
            self.quiet = false
            if #sent.failed > 0 then logger.warn("AISH: not sent", #sent.failed) end
            return
        end
        local text = T(_("AISH library: %1 articles.\n%2 new or updated, %3 removed."), m.articles, #m.written, #m.removed)
        if sent.pushed > 0 or hl.added > 0 then
            text = text .. "\n" .. T(_("Highlights and notes: %1 sent, %2 placed in articles."), sent.pushed, hl.added)
        end
        if #res.failed > 0 then
            text = text .. "\n\n" .. T(_("%1 files could not be read and were skipped (they are tried again next time)."), #res.failed)
            for _, f in ipairs(res.failed) do logger.warn("AISH: skipped", f.name, f.reason) end
        end
        if #sent.failed > 0 then
            text = text .. "\n\n" .. T(_("%1 changes could not be sent yet. They are sent at the next sync."), #sent.failed)
            for _, f in ipairs(sent.failed) do logger.warn("AISH: not sent", f.key, f.reason) end
        end
        notify(text, (#res.failed + #sent.failed) > 0 and nil or 4)
    end)
    if not ok then logger.err("AISH: sync failed", err); self.quiet = false; self:fail(T(_("Sync failed:\n%1"), tostring(err))) end
end

-- ── KOReader's highlights ───────────────────────────────────────────────────
local function koDate(iso)
    local y, mo, d, h, mi, sec = tostring(iso or ""):match("^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
    if y then return string.format("%s-%s-%s %s:%s:%s", y, mo, d, h, mi, sec) end
    return os.date("%Y-%m-%d %H:%M:%S")
end

--- Finds an AISH highlight in the open book: the whole quote (its saved context picks the place where it occurs more
--- than once), or for a long one its first and last words.
function AISH:findInDocument(ui, h)
    local doc = ui.document
    local q = tostring((h.quote and h.quote.exact) or h.text or ""):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
    if q == "" then return nil end
    local function search(pat)
        local ok, res = pcall(doc.findAllText, doc, pat, false, 8, 200, false)
        return ok and type(res) == "table" and res or {}
    end
    local function chapter(xp)
        local ok, t = pcall(function() return ui.toc:getTocTitleByPage(xp) end)
        return ok and t or nil
    end
    local hits = #q <= 300 and search(q) or {}
    if #hits > 0 then
        local best, bestScore = hits[1], -1
        local pre = tostring(h.quote and h.quote.prefix or ""):gsub("%s+", " "):sub(-20)
        local suf = tostring(h.quote and h.quote.suffix or ""):gsub("%s+", " "):sub(1, 20)
        for _, r in ipairs(hits) do
            local score = 0
            local prev = tostring(r.prev_text or ""):gsub("%s+", " ")
            local nxt = tostring(r.next_text or ""):gsub("%s+", " ")
            if pre:match("%S") and prev:find(pre:match("(%S+)%s*$") or "\0", 1, true) then score = score + 1 end
            if suf:match("%S") and nxt:find(suf:match("^%s*(%S+)") or "\0", 1, true) then score = score + 1 end
            if score > bestScore then best, bestScore = r, score end
        end
        return { pos0 = best.start, pos1 = best["end"], text = q, chapter = chapter(best.start) }
    end
    local words = {}
    for w in q:gmatch("%S+") do words[#words + 1] = w end
    if #words < 8 then return nil end
    local heads = search(table.concat(words, " ", 1, 6))
    local tails = search(table.concat(words, " ", #words - 5, #words))
    for _, a in ipairs(heads) do
        for _, b in ipairs(tails) do
            if doc:compareXPointers(a.start, b["end"]) == 1 then
                return { pos0 = a.start, pos1 = b["end"], text = q, chapter = chapter(a.start) }
            end
        end
    end
end

--- One article's highlights in step: in the open book (`ui`), or in its sidecar when it is closed.
function AISH:reconcileArticle(lib, id, ui)
    local Annots = require("aishlib.annots")
    local hls, comments = lib.highlightsOf(id)
    local base = lib.links[id] or {}
    local o = {
        hls = hls, comments = comments, base = base, gone = self.gone or lib.goneHighlights(),
        newHighlight = function(it) return Annots.highlightValues(lib, id, it) end,
        newItem = function(h, placed, note)
            return { page = placed.pos0, pos0 = placed.pos0, pos1 = placed.pos1, text = placed.text, note = note, chapter = placed.chapter,
                datetime = koDate(h.timestamp), drawer = h.type == "ghost" and "underscore" or "lighten",
                color = h.type ~= "ghost" and ui and ui.view and ui.view.highlight and ui.view.highlight.saved_color or nil }
        end,
    }
    local act
    if ui then
        local ann = ui.annotation
        o.items = ann.annotations
        o.find = function(h) return self:findInDocument(ui, h) end
        o.add = function(it) ann:addItem(it) end
        o.remove = function(i) table.remove(ann.annotations, i) end
        act = Annots.reconcile(o)
        if act.added + act.removed + act.notesHere > 0 then
            ui:handleEvent(Event:new("AnnotationsModified", { ann.annotations[1] or {}, nb_highlights_added = act.added - act.removed, index_modified = 0 }))
            UIManager:setDirty(ui.dialog, "ui")
        end
    else
        local st = lib.state[id]
        if not st or not DocSettings:hasSidecarFile(st.file) then return nil end
        local ds = DocSettings:open(st.file)
        local items = ds:readSetting("annotations")
        if type(items) ~= "table" or #items == 0 then return nil end
        o.items = items
        act = Annots.reconcile(o)
        if act.removed + act.notesHere + #act.create > 0 then ds:saveSetting("annotations", items); ds:flush() end
    end
    Annots.apply(lib, id, act, base)
    return act
end

--- Every AISH article: the open one through the reader, the others through their sidecars (only books opened before).
function AISH:reconcileAll(lib)
    local total = { added = 0 }
    self.gone = lib.goneHighlights()
    self.reconciling = true
    local openFile = self.ui and self.ui.document and self.ui.document.file
    for id, st in pairs(lib.state) do
        local ok, act = pcall(self.reconcileArticle, self, lib, id, (st.file == openFile) and self.ui or nil)
        if not ok then logger.warn("AISH: highlights of", st.file, act)
        elseif act then total.added = total.added + act.added end
    end
    self.gone = nil
    self.reconciling = false
    return total
end

--- Opening an AISH article: its highlights in step, and it counts as read in AISH.
function AISH:onReaderReady()
    local file = self.ui and self.ui.document and self.ui.document.file
    if not file or not self:isConnected() then return end
    UIManager:nextTick(function()
        local ok, err = pcall(function()
            local lib = self:library()
            local id = lib.articleOfFile(file)
            if not id then return end
            self.open_article = id
            local art = lib.article(id)
            if art and not require("aishlib.json").val(art.values.readAt) then lib.edit("article:" .. id, { readAt = lib.isoNow() }) end
            self.reconciling = true
            self:reconcileArticle(lib, id, self.ui)
        end)
        self.reconciling = false
        if not ok then logger.warn("AISH: on open", err) end
    end)
end

--- A highlight or note made, changed or removed in an open AISH article: linked to AISH right away, so the link is saved
--- with the book's own settings (our own changes raise this event too: ignored).
function AISH:onAnnotationsModified()
    if not self.open_article or self.reconciling then return end
    if self.reconcile_scheduled then return end
    self.reconcile_scheduled = true
    UIManager:nextTick(function()
        self.reconcile_scheduled = false
        if not self.open_article or not (self.ui and self.ui.document) then return end
        self.reconciling = true
        local ok, err = pcall(function() self:reconcileArticle(self:library(), self.open_article, self.ui) end)
        self.reconciling = false
        if not ok then logger.warn("AISH: highlights", err) end
    end)
end

--- Closing one: what changed in it goes out right away when the reader is online (quietly; the next sync retries).
function AISH:onCloseDocument()
    if not self.open_article then return end
    local id = self.open_article
    self.open_article = nil
    local ok, err = pcall(function()
        local lib = self:library()
        self.reconciling = true
        self:reconcileArticle(lib, id, self.ui)
        self.reconciling = false
        if lib.pendingCount() > 0 and self.settings:nilOrTrue("send_on_close") and NetworkMgr:isOnline() and not self.syncing then
            self.quiet = true
            UIManager:scheduleIn(1, function() self:sync() end)
        end
    end)
    self.reconciling = false
    if not ok then logger.warn("AISH: on close", err) end
end

--- An article deleted in AISH: the file, KOReader's sidecar for it, and its place in history and collections.
function AISH:removeArticle(path)
    os.remove(path)
    pcall(function() DocSettings.updateLocation(path) end)
    pcall(function() require("readhistory"):fileDeleted(path) end)
    pcall(function() require("readcollection"):removeItem(path) end)
end

--- AISH collections → KOReader collections "AISH: <name>", for the files this plugin made (others are never touched).
function AISH:updateCollections(collections, ourFiles)
    local ok, err = pcall(function()
        local RC = require("readcollection")
        local real = function(p) return ffiUtil.realpath(p) or p end
        local want = {}   -- collection → set of files
        for file, names in pairs(collections) do
            for _, n in ipairs(names) do
                local cn = COLL_PREFIX .. n
                want[cn] = want[cn] or {}
                want[cn][file] = true
            end
        end
        local ours = {}
        for _, f in ipairs(ourFiles) do ours[real(f)] = true end
        local touched = {}
        for cn, files in pairs(want) do
            if not RC.coll[cn] then RC:addCollection(cn) end
            if RC:addItemsMultiple(files, { [cn] = true }) > 0 then touched[cn] = true end
        end
        for cn, coll in pairs(RC.coll) do   -- an article that left an AISH collection leaves the KOReader one
            if cn:sub(1, #COLL_PREFIX) == COLL_PREFIX then
                local keep = {}
                for f in pairs(want[cn] or {}) do keep[real(f)] = true end
                for f in pairs(coll) do
                    if ours[f] and not keep[f] then coll[f] = nil; touched[cn] = true end
                end
            end
        end
        if next(touched) then RC:write(touched) end
    end)
    if not ok then logger.warn("AISH: collections not updated", err) end
end

return AISH
