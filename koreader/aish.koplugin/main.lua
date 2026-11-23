--[[--
Kaivo library for KOReader.

Connects to the encrypted sync place of the Kaivo browser extension (a folder on your Nextcloud/WebDAV server), decrypts it
on the reader and keeps a folder of HTML files: per article the AI summary, the full text and your notes. Kaivo collections
become KOReader collections ("Kaivo: <name>").

Highlights are KOReader's own: Kaivo highlights appear as KOReader highlights when an article is opened (AI ones underlined,
comments as notes), and highlights and notes made on the reader go back to Kaivo, like deleting one and opening an article
(it counts as read). Changes made on the reader are sent at the next sync, and when a Kaivo article is closed while online.

Security: "Connect with Nextcloud" logs the reader in with its own token (Login Flow v2: a QR code opened on the phone).
"Wipe device" in Nextcloud then removes the Kaivo library from the reader the next time it is online; the token can be
revoked there at once. An optional PIN seals the login and the library key in KOReader's settings (aishlib/vault.lua).

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

local COLL_PREFIX = "Kaivo: "    -- your Kaivo collections
local TAB_PREFIX = "Kaivo · "     -- the Kaivo tabs: Inbox, Read, Archive
local TAG_PREFIX = "Kaivo #"      -- the most used tags
-- the names before the rename (AISH): still ours, so a sync removes them and the new names take their place
local LEGACY_PREFIXES = { "AISH: ", "AISH · ", "AISH #" }
local function isOurName(name)
    for __, p in ipairs({ COLL_PREFIX, TAB_PREFIX, TAG_PREFIX, LEGACY_PREFIXES[1], LEGACY_PREFIXES[2], LEGACY_PREFIXES[3] }) do
        if name:sub(1, #p) == p then return true end
    end
    return false
end
local TOP_TAGS = 10
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
    touch = function(p, t) pcall(lfs.touch, p, t, t) end,
}

-- KOReader makes one instance of a plugin for the file browser and one for each opened book. What must not differ
-- between them lives here, once: the settings object (two copies would overwrite each other's changes), the PIN-unlocked
-- secrets and whether a sync is running.
local shared = {}

local AISH = WidgetContainer:extend{
    name = "aish",
    is_doc_only = false,
}

function AISH:init()
    shared.settings = shared.settings or LuaSettings:open(DataStorage:getSettingsDir() .. "/aish.lua")
    self.settings = shared.settings
    if not (self.ui and self.ui.document) then shared.browser = self end   -- the file browser's instance outlives a book
    self.data_dir = DataStorage:getDataDir() .. "/aish"
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function AISH:onDispatcherRegisterActions()
    Dispatcher:registerAction("aish_sync", { category = "none", event = "AishSync", title = _("Kaivo: sync library"), general = true })
    Dispatcher:registerAction("aish_newest", { category = "none", event = "AishOpenNewest", title = _("Kaivo: open newest unread"), general = true })
    Dispatcher:registerAction("aish_inbox", { category = "none", event = "AishShowInbox", title = _("Kaivo: show Inbox"), general = true })
end

-- ── settings ────────────────────────────────────────────────────────────────
function AISH:conn() return self.settings:readSetting("connection") end
function AISH:isConnected() local c = self:conn(); return c and c.url and c.url ~= "" end
--- A path as KOReader names the open book: real path, no doubled or trailing slashes (a home folder set as
--- "/mnt/onboard/" made "/mnt/onboard//Kaivo/…", and the open article was never recognised).
local function normPath(p)
    if not p then return p end
    local dir, name = p:match("^(.*)/([^/]*)$")
    local real = dir and dir ~= "" and ffiUtil.realpath(dir)
    p = real and (real .. "/" .. name) or p
    return (p:gsub("//+", "/"):gsub("(.)/$", "%1"))
end
AISH.normPath = normPath
AISH._shared = shared   -- for the tests: a restart of KOReader starts with none

function AISH:outDir()
    local d = self.settings:readSetting("folder")
    if not (d and d ~= "") then
        local home = G_reader_settings:readSetting("home_dir") or require("apps/filemanager/filemanagerutil").getDefaultDir()
        local base = home or DataStorage:getDataDir()
        d = base .. "/Kaivo"
        -- before the rename the folder was called AISH: an existing one stays in use (its files are known by their paths)
        local old = base .. "/AISH"
        if lfs.attributes(old, "mode") == "directory" and lfs.attributes(d, "mode") ~= "directory" then d = old end
    end
    return (d:gsub("//+", "/"):gsub("(.)/$", "%1"))
end
function AISH:save() self.settings:flush() end

-- ── secrets: the Nextcloud password and the library key, plain or sealed with a PIN ──
function AISH:isSealed() return self.settings:readSetting("sealed") ~= nil end
function AISH:isLocked() return self:isSealed() and not shared.secrets end
function AISH:secret(name)
    if self:isSealed() then return shared.secrets and shared.secrets[name] end
    if name == "password" then local c = self:conn(); return c and c.password end
    return self.settings:readSetting("master")
end
--- Stores secrets: sealed while the PIN protection is on and unlocked; a new login while it is locked turns it off.
function AISH:setSecrets(changes)
    local Vault = require("aishlib.vault")
    local sealed = self.settings:readSetting("sealed")
    if sealed and shared.vault_key then
        shared.secrets = shared.secrets or {}
        for k, v in pairs(changes) do shared.secrets[k] = v end
        self.settings:saveSetting("sealed", Vault.seal(shared.secrets, shared.vault_key, Vault.saltOf(sealed), sealed.rounds))
    else
        if sealed then
            self.settings:delSetting("sealed"); shared.secrets, shared.vault_key = nil, nil
            notify(_("The PIN protection was turned off with the new connection. You can turn it on again in the menu."))
        end
        local c = self:conn()
        if changes.password ~= nil and c then c.password = changes.password; self.settings:saveSetting("connection", c) end
        if changes.master ~= nil then self.settings:saveSetting("master", changes.master) end
    end
    self:save()
end
function AISH:saveConnection(conn, secrets)
    self.settings:delSetting("salt")   -- the kept library key belongs to the old place
    if self:isSealed() and shared.vault_key then   -- PIN on and unlocked: the new login is sealed too
        conn.password = nil
        self.settings:saveSetting("connection", conn)
        shared.secrets = { password = secrets.password }
        self:setSecrets({})
    else
        if self:isSealed() then
            self.settings:delSetting("sealed"); shared.secrets, shared.vault_key = nil, nil
            notify(_("The PIN protection was turned off with the new connection. You can turn it on again in the menu."))
        end
        conn.password = secrets.password
        self.settings:saveSetting("connection", conn)
        self.settings:delSetting("master")
    end
    self:save()
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

-- ── menu ────────────────────────────────────────────────────────────────────
function AISH:addToMainMenu(menu_items)
    menu_items.aish_library = {
        text = _("Kaivo library"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Sync now"),
                enabled_func = function() return self:isConnected() end,
                callback = function() self:syncNow() end,
            },
            {
                text = _("Open newest unread"),
                enabled_func = function() return self:isConnected() end,
                callback = function() self:onAishOpenNewest() end,
            },
            {
                text = _("Show Inbox"),
                enabled_func = function() return self:isConnected() end,
                callback = function() self:onAishShowInbox() end,
            },
            {
                text = _("Go to Kaivo folder"),
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
                text = _("Connect with Nextcloud (QR code)"),
                help_text = _([[The reader gets its own Nextcloud login: scan the code with your phone, log in there and allow access. Nothing to type on the reader.

If the reader is lost: Nextcloud → Settings → Security → Devices & sessions → "Kaivo KOReader" → Wipe device. The login stops working at once, and the next time the reader is online the plugin deletes the Kaivo library, its login and key from it.

Tip: give the reader a Nextcloud user of its own that only has the Kaivo folder shared with it.]]),
                keep_menu_open = true,
                callback = function(touchmenu) self:connectWithNextcloud(touchmenu) end,
            },
            {
                text = _("Connect with a code"),
                help_text = T(_([[In the Kaivo extension: Settings → Sync & backup → your encrypted place → "Show code for the phone" → "Save code as file (KOReader)".

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
                            self.settings:saveSetting("folder", path .. "/Kaivo"); self:save()
                            if touchmenu then touchmenu:updateItems() end
                        end,
                    }:chooseDir()
                end,
            },
            {
                text = _("Protect login and key with a PIN"),
                help_text = _([[The Nextcloud login and the key of the library are kept sealed with a PIN; KOReader asks for it once after each start, when the library is synced.

It keeps a lost reader's settings from giving away your login. A short PIN can still be guessed by someone with the copied files and enough computing power, and the articles already on the reader stay readable.]]),
                enabled_func = function() return self:isConnected() end,
                checked_func = function() return self:isSealed() end,
                keep_menu_open = true,
                callback = function(touchmenu) self:togglePin(touchmenu) end,
            },
            {
                text_func = function()
                    return T(_("Format: %1"), (self.settings:readSetting("format") or "epub") == "epub" and "EPUB" or "HTML")
                end,
                sub_item_table = {
                    {
                        text = _("EPUB: book information and cover"),
                        help_text = _([[Each article is a small book: the source as author, the date saved, the tags, the summary as description, the Kaivo collection as series, a cover with the title, and a table of contents. KOReader shows it in its lists, the cover view and Book information.

Writing takes longer, mostly for the covers: the first time, a library of a few hundred articles can take minutes. After that only new or changed articles are written.]]),
                        checked_func = function() return (self.settings:readSetting("format") or "epub") == "epub" end,
                        radio = true,
                        callback = function() self:setFormat("epub") end,
                    },
                    {
                        text = _("HTML: fastest"),
                        help_text = _([[Plain HTML files: written several times faster, no book information. The cover is KOReader's custom cover for the file. Summary, article, key points and notes are the same.]]),
                        checked_func = function() return self.settings:readSetting("format") == "html" end,
                        radio = true,
                        callback = function() self:setFormat("html") end,
                    },
                },
            },
            {
                text_func = function()
                    local n = tonumber(self.settings:readSetting("limit"))
                    return T(_("Articles on this reader: %1"), n and tostring(n) or _("all"))
                end,
                help_text = _("Only the newest articles (by the date saved in Kaivo) are put on the reader. Older ones are removed from it after their highlights and notes went out; they stay in Kaivo and come back when you raise the limit."),
                sub_item_table_func = function()
                    local items = {}
                    for __, n in ipairs({ 25, 50, 100, 0 }) do
                        items[#items + 1] = {
                            text = n == 0 and _("Unlimited") or tostring(n),
                            radio = true,
                            checked_func = function() return (tonumber(self.settings:readSetting("limit")) or 0) == n end,
                            callback = function() self:setLimit(n, "limit") end,
                        }
                    end
                    items[#items].separator = true
                    items[#items + 1] = {
                        text = _("Include archive"),
                        help_text = _("Off: articles archived in Kaivo are not put on the reader (and are removed from it)."),
                        checked_func = function() return self.settings:nilOrTrue("include_archive") end,
                        callback = function() self.settings:flipNilOrTrue("include_archive"); self:setLimit() end,
                    }
                    return items
                end,
            },
            {
                text = _("Include images"),
                help_text = _([[The images saved with the articles, in both formats (up to a few MB per article). Off: smaller files and faster writing; each image shows its description instead.]]),
                checked_func = function() return self.settings:nilOrTrue("images") end,
                callback = function()
                    self.settings:flipNilOrTrue("images"); self:save()
                    notify(_("The articles are written again at the next sync (nothing is downloaded again)."), 3)
                end,
            },
            {
                text = _("Sync automatically"),
                help_text = _("When Wi-Fi comes on or the reader wakes up, and the last sync is more than 30 minutes ago. Not while an article is open; changes made in it are sent when you close it."),
                checked_func = function() return self.settings:nilOrTrue("auto_sync") end,
                callback = function() self.settings:flipNilOrTrue("auto_sync"); self:save() end,
            },
            {
                text = _("Finished articles go to the Kaivo archive"),
                help_text = _("When you mark a Kaivo article as finished in KOReader (or reach its end with that setting), it is archived in Kaivo."),
                checked_func = function() return self.settings:nilOrTrue("finished_archive") end,
                callback = function() self.settings:flipNilOrTrue("finished_archive"); self:save() end,
            },
            {
                text = _("Collections for the 10 most used tags"),
                checked_func = function() return self.settings:nilOrTrue("tag_collections") end,
                callback = function() self.settings:flipNilOrTrue("tag_collections"); self:save() end,
            },
            {
                text = _("Send changes when closing an article"),
                help_text = _("Highlights, notes and read marks made on the reader go to Kaivo as soon as you close the article, when Wi-Fi is on. Otherwise they go at the next sync."),
                checked_func = function() return self.settings:nilOrTrue("send_on_close") end,
                callback = function() self.settings:flipNilOrTrue("send_on_close"); self:save() end,
            },
            {
                text = _("Download everything again"),
                help_text = _("Removes the Kaivo articles from this reader and downloads the whole library again, with the newest layout. Highlights and notes made on the reader are sent to Kaivo first and come back; reading positions start over."),
                enabled_func = function() return self:isConnected() end,
                keep_menu_open = true,
                callback = function() self:downloadAgain() end,
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
    if not c then notify(_("This is not a Kaivo library code. It starts with aish-library://")); return end
    if c.kind ~= "webdav" then notify(_("This reader can only use a Nextcloud/WebDAV place for now, not S3.")); return end
    self:saveConnection({ url = c.url, username = c.username, root = c.root }, { password = c.password })
    if touchmenu then touchmenu:updateItems() end
    self:syncNow(c.words)
end

function AISH:connectWithCode(touchmenu)
    -- a code file put on the reader over USB wins: typing a long code on an e-ink keyboard is no fun
    local FileManagerUtil = require("apps/filemanager/filemanagerutil")
    local home = G_reader_settings:readSetting("home_dir") or FileManagerUtil.getDefaultDir()
    for __, dir in ipairs({ home, DataStorage:getDataDir(), self:outDir() }) do
        local path = dir and (dir .. "/" .. CODE_FILE)
        local text = path and fs.read(path)
        if text and text:find("aish%-library://") then
            os.remove(path)
            logger.info("Kaivo: read the connection code from", path, "and removed the file")
            self:applyCode(text:match("aish%-library://%S+"), touchmenu)
            return
        end
    end
    local dialog
    dialog = InputDialog:new{
        title = _("Kaivo library code"),
        description = T(_("Paste the code from the extension, or put it in a file named %1 in your home folder."), CODE_FILE),
        input_hint = "aish-library://v1?…",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
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
        title = _("Kaivo library on Nextcloud/WebDAV"),
        fields = {
            { text = c.url or "", hint = _("WebDAV address, e.g. https://cloud.example.com/remote.php/dav/files/you/") },
            { text = c.username or "", hint = _("User") },
            { text = self:secret("password") or "", text_type = "password", hint = _("App password") },
            { text = c.root or "aish-sync", hint = _("Folder of the Kaivo place") },
        },
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
            { text = _("Save and sync"), callback = function()
                local f = dialog:getFields()
                UIManager:close(dialog)
                if not f[1]:match("^https?://") then notify(_("The address must start with https://")); return end
                self:saveConnection({ url = util.trim(f[1]), username = util.trim(f[2]), root = util.trim(f[4]) ~= "" and util.trim(f[4]) or "aish-sync" }, { password = f[3] })
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
        text = _("Forget the login and the key of the Kaivo library on this reader?\n\nThe downloaded articles stay in the Kaivo folder; delete it in the file browser if you no longer want them."),
        ok_text = _("Disconnect"),
        ok_callback = function()
            local c, pw = self:conn(), self:secret("password")
            if c and c.flow and pw and NetworkMgr:isOnline() then   -- the reader's own login: given back to Nextcloud
                pcall(function() require("aishlib.nc").new().revoke(c.server or require("aishlib.nc").serverOf(c.url), c.username, pw) end)
            end
            for __, k in ipairs({ "connection", "master", "salt", "last_sync", "sealed" }) do self.settings:delSetting(k) end
            shared.secrets, shared.vault_key = nil, nil
            self:save()
            ffiUtil.purgeDir(self.data_dir)
            if touchmenu then touchmenu:updateItems() end
            notify(_("Disconnected."), 2)
        end,
    })
end

function AISH:connectWithNextcloud(touchmenu)
    local N = require("aishlib.nc")
    local c = self:conn() or {}
    local dialog
    dialog = MultiInputDialog:new{
        title = _("Connect with Nextcloud"),
        fields = {
            { text = c.server or N.serverOf(c.url) or "", hint = _("Address of your Nextcloud, e.g. cloud.example.com") },
            { text = c.root or "aish-sync", hint = _("Folder of the Kaivo place") },
        },
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
            { text = _("Show QR code"), callback = function()
                local f = dialog:getFields()
                UIManager:close(dialog)
                local server = N.normalizeServer(f[1])
                if not server then notify(_("Enter the address of your Nextcloud.")); return end
                local root = util.trim(f[2] or "") ~= "" and util.trim(f[2]) or "aish-sync"
                NetworkMgr:runWhenOnline(function() self:loginFlow(server, root, touchmenu) end)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:loginFlow(server, root, touchmenu)
    local N = require("aishlib.nc")
    local nc = N.new()
    local start, err = nc.startLogin(server)
    if not start then notify(T(_("Could not start the Nextcloud login:\n%1"), err or "?")); return end
    local QRMessage = require("ui/widget/qrmessage")
    local wait = { endpoint = start.endpoint, token = start.token, deadline = os.time() + 20 * 60 }
    self.login_wait = wait
    local qr
    qr = QRMessage:new{
        title = _("Scan with your phone, log in to Nextcloud and allow access"),
        text = start.login,
        dismiss_callback = function() if self.login_wait == wait then self.login_wait = nil end end,
    }
    UIManager:show(qr)
    local function tick()
        if self.login_wait ~= wait then return end
        local r, perr = nc.poll(wait.endpoint, wait.token)
        if r == false then
            if os.time() < wait.deadline then UIManager:scheduleIn(2, tick); return end
            perr = _("The login was not finished within 20 minutes.")
        end
        self.login_wait = nil
        UIManager:close(qr)
        if not r then notify(T(_("Nextcloud login failed:\n%1"), perr or "?")); return end
        local srv = N.normalizeServer(r.server) or server
        local user = r.loginName
        local enc = user:gsub("[^%w%-%._~@]", function(ch) return string.format("%%%02X", ch:byte()) end)
        self:saveConnection({ url = srv .. "/remote.php/dav/files/" .. enc .. "/", username = user, root = root, server = srv, flow = true }, { password = r.appPassword })
        if touchmenu then touchmenu:updateItems() end
        self:syncNow()
    end
    UIManager:scheduleIn(2, tick)
end

--- Asks for the PIN and unlocks the sealed secrets for this KOReader session.
function AISH:askPin(onOk, title)
    local Vault = require("aishlib.vault")
    local dialog
    dialog = InputDialog:new{
        title = title or _("PIN of the Kaivo library"),
        text_type = "password", input_type = "number",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
            { text = _("Unlock"), is_enter_default = true, callback = function()
                local pin = dialog:getInputText()
                UIManager:close(dialog)
                self:progress(_("Unlocking…"))
                UIManager:nextTick(function()
                    local secrets, key = Vault.open(self.settings:readSetting("sealed"), pin)
                    self:endProgress()
                    if not secrets then
                        UIManager:show(InfoMessage:new{ text = _("Wrong PIN."), icon = "notice-warning", timeout = 3 })
                        return
                    end
                    shared.secrets, shared.vault_key = secrets, key
                    onOk()
                end)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:togglePin(touchmenu)
    local Vault = require("aishlib.vault")
    if self:isSealed() then   -- off: needs the PIN once
        local function off()
            local sec = shared.secrets or {}
            self.settings:delSetting("sealed"); shared.secrets, shared.vault_key = nil, nil
            local c = self:conn()
            if c then c.password = sec.password; self.settings:saveSetting("connection", c) end
            if sec.master then self.settings:saveSetting("master", sec.master) end
            self:save()
            if touchmenu then touchmenu:updateItems() end
            notify(_("The PIN protection is off."), 3)
        end
        if self:isLocked() then self:askPin(off) else off() end
        return
    end
    local first
    local function ask(title, cont)
        local dialog
        dialog = InputDialog:new{
            title = title, text_type = "password", input_type = "number",
            description = _("At least 6 digits. It cannot be recovered: without it, connect the reader again."),
            buttons = { {
                { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
                { text = _("OK"), is_enter_default = true, callback = function() local v = dialog:getInputText(); UIManager:close(dialog); cont(v) end },
            } },
        }
        UIManager:show(dialog)
        dialog:onShowKeyboard()
    end
    ask(_("New PIN"), function(pin)
        if not tostring(pin):match("^%d%d%d%d%d%d+$") then notify(_("The PIN needs at least 6 digits.")); return end
        first = pin
        ask(_("The PIN again"), function(again)
            if again ~= first then notify(_("The two PINs are not the same.")); return end
            self:progress(_("Sealing…"))
            UIManager:nextTick(function()
                local secrets = { password = self:secret("password"), master = self:secret("master") }
                local sealed, key = Vault.create(secrets, first)
                self.settings:saveSetting("sealed", sealed)
                local c = self:conn()
                if c then c.password = nil; self.settings:saveSetting("connection", c) end
                self.settings:delSetting("master")
                self:save()
                shared.secrets, shared.vault_key = secrets, key
                self:endProgress()
                if touchmenu then touchmenu:updateItems() end
                notify(_("Login and key are sealed with your PIN. KOReader asks for it once after each start, when the library is synced."), 5)
            end)
        end)
    end)
end

--- After the server refused the login: was this reader removed in Nextcloud ("Wipe device")? Then everything goes.
function AISH:checkWipe()
    local N = require("aishlib.nc")
    local c, pw = self:conn(), self:secret("password")
    if not (c and pw and pw ~= "") then return false end
    local server = c.server or N.serverOf(c.url)
    local nc = N.new()
    local ok, wipe = pcall(nc.wipeRequested, server, pw)
    if not (ok and wipe) then return false end
    self:wipeAll()
    pcall(nc.wipeDone, server, pw)
    self:endProgress()
    UIManager:show(InfoMessage:new{ text = _("This reader was removed in your Nextcloud (Wipe device). The Kaivo library, its login and key were deleted from it.") })
    return true
end

function AISH:wipeAll()
    pcall(function()
        local lib = self:library()
        for __, f in ipairs(lib.files()) do self:removeArticle(f) end
    end)
    pcall(function()
        local RC = require("readcollection")
        local gone = {}
        for name in pairs(RC.coll) do
            if isOurName(name) then gone[#gone + 1] = name end
        end
        for __, name in ipairs(gone) do RC:removeCollection(name) end
    end)
    ffiUtil.purgeDir(self.data_dir)
    for __, k in ipairs({ "connection", "master", "salt", "sealed", "last_sync", "folder" }) do self.settings:delSetting(k) end
    shared.secrets, shared.vault_key = nil, nil
    self:save()
end

-- ── syncing ─────────────────────────────────────────────────────────────────
function AISH:onAishSync() self:syncNow(); return true end

function AISH:downloadAgain()
    if self.ui and self.ui.document and self.open_article then
        notify(_("Close the Kaivo article first."), 3); return
    end
    UIManager:show(ConfirmBox:new{
        text = _("Remove the Kaivo articles from this reader and download the whole library again?\n\nHighlights and notes made on the reader are sent to Kaivo first and come back. Reading positions start over."),
        ok_text = _("Download again"),
        ok_callback = function() self.fresh = true; self:syncNow() end,
    })
end

--- The newest article not read yet (from the last sync's Inbox, else from the files this plugin made).
function AISH:newestUnread()
    local inbox = self.inbox
    if not inbox then
        local RC = require("readcollection")
        local coll = RC.coll[TAB_PREFIX .. _("Inbox")]
        if coll then
            local list = RC:getOrderedCollection(TAB_PREFIX .. _("Inbox"))
            inbox = {}
            for __, it in ipairs(list) do inbox[#inbox + 1] = it.file end
        end
    end
    for __, f in ipairs(inbox or {}) do
        if lfs.attributes(f, "mode") == "file" and not (self.ui.document and self.ui.document.file == f) then return f end
    end
end
function AISH:onAishOpenNewest()
    local f = self:newestUnread()
    if not f then notify(_("Nothing unread in the Kaivo Inbox."), 3); return true end
    if self.ui.document then self.ui:switchDocument(f)
    else require("apps/reader/readerui"):showReader(f) end
    return true
end
function AISH:onAishShowInbox()
    local name = TAB_PREFIX .. _("Inbox")
    if not require("readcollection").coll[name] then notify(_("Sync the Kaivo library first."), 3); return true end
    if self.ui.collections then self.ui.collections:onShowColl(name) end
    return true
end

--- Wi-Fi on, or the reader woke up: a quiet sync when it is due (not while reading, not while locked by the PIN).
function AISH:autoSync()
    if not self:isConnected() or not self.settings:nilOrTrue("auto_sync") or shared.syncing or self:isLocked() then return end
    if self.ui and self.ui.document then return end
    local last = self.settings:readSetting("last_sync")
    local waiting = (tonumber(self.settings:readSetting("pending")) or 0) > 0   -- changes from the reader go out at once
    if not waiting and last and os.time() - (last.time or 0) < (tonumber(self.settings:readSetting("auto_sync_minutes")) or 30) * 60 then return end
    if not NetworkMgr:isOnline() then return end
    self.quiet = true
    self:sync()
end
function AISH:onNetworkConnected() UIManager:scheduleIn(3, function() self:autoSync() end) end
function AISH:onResume() UIManager:scheduleIn(5, function() self:autoSync() end) end

function AISH:syncNow(words)
    if not self:isConnected() then notify(_("Connect the Kaivo library first (Tools → Kaivo library).")); return end
    if shared.syncing then return end
    if self:isLocked() then
        if self.quiet then self.quiet = false; return end   -- a background sync never asks
        return self:askPin(function() self:syncNow(words) end)
    end
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
    shared.syncing = false
end
function AISH:fail(text)
    self.fresh = nil   -- a "download everything again" that did not get through is not done later by surprise
    self:endProgress()
    if self.quiet then logger.warn("Kaivo: quiet sync failed:", text); self.quiet = false; return end
    UIManager:show(InfoMessage:new{ text = text, icon = "notice-warning" })
end

function AISH:library(store)
    return require("aishlib.library").new({
        store = store, fs = fs, dataDir = self.data_dir, outDir = self:outDir(), format = self.settings:readSetting("format") or "epub", images = self.settings:nilOrTrue("images"),
        limit = self.settings:readSetting("limit"), archive = self.settings:nilOrTrue("include_archive"),
        cover = function(info) return self:makeCover(info) end,
        sidecarCover = function(file, bytes) self:setSidecarCover(file, bytes) end,
        labels = { summary = _("Summary"), notes = _("Notes"), noText = _("The full text of this article was not saved in Kaivo.") },
    })
end

function AISH:makeStore()
    local c = self:conn()
    return require("aishlib.webdav").new({
        url = c.url, root = c.root, username = c.username, password = self:secret("password") or "", http = require("socket.http"),
        beforeRequest = function() socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT) end,
        afterRequest = function() socketutil:reset_timeout() end,
    })
end

--- The keys for `meta`: the kept key when it still opens the place, else the passphrase (from the code, or asked for).
function AISH:withKeys(meta, words, cont)
    local C, Code = require("aishlib.crypto"), require("aishlib.code")
    local master = self:secret("master")
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
            self.settings:saveSetting("salt", meta.salt)
            self:setSecrets({ master = C.toHex(m) })
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
        title = _("Passphrase of the Kaivo library"),
        description = _("The words (or your own passphrase) you chose when you made the encrypted place in the extension. It is not saved; the key made from it is."),
        text_type = "password",
        buttons = { {
            { text = _("Cancel"), id = "close", callback = function() self.fresh = nil; UIManager:close(dialog) end },
            { text = _("Unlock"), is_enter_default = true, callback = function()
                local p = dialog:getInputText()
                UIManager:close(dialog)
                shared.syncing = true
                onOk(p)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function AISH:sync(words)
    shared.syncing = true
    self:progress(_("Connecting to the Kaivo library…"))
    UIManager:nextTick(function()
        local ok, err = pcall(function()
            local json = require("aishlib.json")
            local store = self:makeStore()
            local raw, gerr, status = store.get("meta.json")
            if (status == 401 or status == 403) and self:checkWipe() then return end
            if raw == false then return self:fail(_("No Kaivo library in this folder. Check the folder name of the place.")) end
            if not raw then return self:fail(T(_("Could not reach the library:\n%1"), gerr or "?")) end
            local meta = json.decode(raw)
            if type(meta) ~= "table" or meta.mode ~= "encrypted" then
                return self:fail(_("This folder holds a readable (not encrypted) Kaivo place. This plugin opens encrypted places."))
            end
            self:withKeys(meta, words, function(keys) self:pullAndWrite(store, meta, keys) end)
        end)
        if not ok then logger.err("Kaivo: sync failed", err); self:fail(T(_("Sync failed:\n%1"), tostring(err))) end
    end)
end

--- The limit (25, 50, 100, 0 = unlimited) or the archive switch changed: what is on the reader follows at the next sync.
function AISH:setLimit(n)
    if n then self.settings:saveSetting("limit", n > 0 and n or nil) end
    self:save()
    notify(_("Applied at the next sync. Nothing is downloaded again."), 3)
end

--- EPUB or HTML. Nothing is downloaded again: the articles are on the reader already and are written in the other format
--- (KOReader's reading positions start over; highlights come back from Kaivo).
function AISH:setFormat(fmt)
    if (self.settings:readSetting("format") or "epub") == fmt then return end
    self.settings:saveSetting("format", fmt); self:save()
    UIManager:show(ConfirmBox:new{
        text = _("Write the articles in the new format now? Nothing is downloaded again; every article is written once (reading positions start over, highlights stay)."),
        ok_text = _("Write now"),
        ok_callback = function() self:sync() end,
    })
end

function AISH:pullAndWrite(store, meta, keys)
    local ok, err = pcall(function()
        local clock = os.time()
        local times = {}
        local function lap(name) local now = os.time(); times[#times + 1] = name .. " " .. (now - clock) .. " s"; clock = now end
        self.cover_time, self.covers_drawn, self.covers_used = 0, 0, {}
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
        lap("download")
        local m = { articles = 0, written = {}, removed = {} }
        if not self.fresh then   -- before "download everything again" deletes them, the files need no rewriting
            self:progress(_("Writing articles…"))
            m = lib.materialize(function(path) self:removeArticle(path) end, function(done, total)
                self:progress(T(_("Writing articles: %1 of %2…"), done, total))
            end)
            lap("write (" .. #m.written .. " files, " .. self.covers_drawn .. " covers drawn in " .. math.floor(self.cover_time) .. " s)")
        end
        -- highlights and notes of every article in KOReader ↔ Kaivo, then what changed here goes out
        self:progress(_("Highlights and notes…"))
        local hl = self:reconcileAll(lib)
        lib.flush()
        lap("highlights")
        local sent = { pushed = 0, failed = {} }
        if lib.pendingCount() > 0 then
            self:progress(_("Sending changes…"))
            sent = lib.push(keys)
        end
        if self.fresh then   -- "Download everything again": what the reader changed is in Kaivo now; then start over
            self.fresh = nil
            if lib.pendingCount() > 0 then
                return self:fail(T(_("%1 changes made on this reader could not be sent, so nothing was deleted. Try again when the reader is online."), lib.pendingCount()))
            end
            self:progress(_("Removing the articles from this reader…"))
            lib.reset(function(path) self:removeArticle(path) end)
            self:updateCollections({ tabs = { inbox = {}, read = {}, archive = {} }, collections = {}, tags = {} }, {})
            for __, k in ipairs({ "reconciled", "finished_sent" }) do self.settings:delSetting(k) end
            self:save()
            return self:pullAndWrite(store, meta, keys)
        end
        -- the collections last: read marks and finished books from this very sync are in them (a second pass reads only the index)
        local openFile = self.ui and self.ui.document and normPath(self.ui.document.file) or nil
        local m2 = lib.materialize(function(path) self:removeArticle(path) end, nil, { prune = lib.pendingCount() == 0, keep = openFile })
        for __, f in ipairs(m2.removed) do m.removed[#m.removed + 1] = f end
        self:updateCollections(m2, lib.files())
        lap("collections")
        if #m.written > 0 then self:pruneCovers() end
        logger.info("Kaivo: sync took", table.concat(times, ", "))
        self.settings:saveSetting("last_sync", { time = os.time(), articles = m2.articles, pending = lib.pendingCount() })
        self.settings:saveSetting("pending", lib.pendingCount()); self:save()
        self:endProgress()
        local FileManager = require("apps/filemanager/filemanager")
        if FileManager.instance then FileManager.instance:onRefresh() end
        if self.quiet then
            self.quiet = false
            if #sent.failed > 0 then logger.warn("Kaivo: not sent", #sent.failed) end
            return
        end
        local text = T(_("Kaivo library: %1 articles on this reader.\n%2 downloaded, %3 files written, %4 removed."), m2.articles, res.fetched, #m.written, #m.removed)
        if m2.left > 0 then text = text .. "\n" .. T(_("%1 older or archived articles are left out (Articles on this reader)."), m2.left) end
        if sent.pushed > 0 or hl.added > 0 then
            text = text .. "\n" .. T(_("Highlights and notes: %1 sent, %2 placed in articles."), sent.pushed, hl.added)
        end
        if #res.failed > 0 then
            text = text .. "\n\n" .. T(_("%1 files could not be read and were skipped (they are tried again next time)."), #res.failed)
            for __, f in ipairs(res.failed) do logger.warn("Kaivo: skipped", f.name, f.reason) end
        end
        if #sent.failed > 0 then
            text = text .. "\n\n" .. T(_("%1 changes could not be sent yet. They are sent at the next sync."), #sent.failed)
            for __, f in ipairs(sent.failed) do logger.warn("Kaivo: not sent", f.key, f.reason) end
        end
        notify(text, (#res.failed + #sent.failed) > 0 and nil or 4)
    end)
    if not ok then logger.err("Kaivo: sync failed", err); self.quiet = false; self:fail(T(_("Sync failed:\n%1"), tostring(err))) end
end

-- ── covers ──────────────────────────────────────────────────────────────────
--[[--
One layout for every article's cover, drawn with KOReader's own fonts (600 × 800, grey levels for e-ink):
  a black band with the site and the date · the title, large · the article's best image, or the start of the summary
  · a thin rule and "Kaivo" at the foot. The title is always there; KOReader fits it by shrinking the font.
]]
local COVER_VERSION = "2"   -- the layout; a change draws every cover again

--- The cover for `info`: from the cache when the same cover was drawn before (a new download of the library, a sync that
--- rewrites the files for another reason), else drawn. The cache lives outside the library data, so "Download everything
--- again" keeps it.
function AISH:makeCover(info)
    local C = require("aishlib.crypto")
    local parts = { COVER_VERSION, info.title or "", info.site or "", info.author or "", info.date or "", info.summary or "",
        table.concat(info.tags or {}, "\1"), info.image and C.toHex(C.hmac("img", info.image)) or "" }
    local key = C.toHex(C.hmac("aish-cover", table.concat(parts, "\0"))):sub(1, 32)
    local dir = DataStorage:getDataDir() .. "/aish-covers"
    local path = dir .. "/" .. key .. ".jpg"
    self.covers_used = self.covers_used or {}
    self.covers_used[key .. ".jpg"] = true
    local cached = fs.read(path)
    if cached then return cached end
    local t0 = os.clock()
    local bytes = self:drawCover(info, dir, path)
    self.cover_time = (self.cover_time or 0) + (os.clock() - t0)
    self.covers_drawn = (self.covers_drawn or 0) + 1
    return bytes
end

--- A cover for an HTML article: KOReader shows `cover.<ext>` from the book's sidecar folder as its cover (Book information →
--- custom cover), whatever the format. flushCustomCover copies a file there, so the bytes go through one temporary file.
function AISH:setSidecarCover(file, bytes)
    local dir = DataStorage:getDataDir() .. "/aish-covers"
    local tmp = dir .. "/.sidecar." .. (bytes:sub(1, 2) == "\255\216" and "jpg" or "png")
    fs.mkdirp(dir)
    fs.write(tmp, bytes)
    pcall(function() DocSettings:flushCustomCover(file, tmp) end)
    os.remove(tmp)
end

--- Cover files no article uses any more (only after a run that looked at every article).
function AISH:pruneCovers()
    local dir = DataStorage:getDataDir() .. "/aish-covers"
    if not self.covers_used or lfs.attributes(dir, "mode") ~= "directory" then return end
    for f in lfs.dir(dir) do
        if f:match("%.jpg$") and not self.covers_used[f] then os.remove(dir .. "/" .. f) end
    end
end

function AISH:drawCover(info, dir, path)
    local Blitbuffer = require("ffi/blitbuffer")
    local Font = require("ui/font")
    local TextBoxWidget = require("ui/widget/textboxwidget")
    local W, H, M = 600, 800, 36
    local bb = Blitbuffer.new(W, H, Blitbuffer.TYPE_BB8)
    bb:fill(Blitbuffer.COLOR_WHITE)
    local function text(t, face, size, width, opts)
        opts = opts or {}
        local w = TextBoxWidget:new{ text = t, face = Font:getFace(face, size), width = width, alignment = opts.align or "left",
            bold = opts.bold, fgcolor = opts.color, bgcolor = opts.bg, height = opts.height, height_overflow_show_ellipsis = opts.height ~= nil }
        return w
    end
    -- the band: site on the left, date on the right, one line (a long site name is cut with "…", never wrapped)
    local TextWidget = require("ui/widget/textwidget")
    local BAND = 64
    bb:paintRect(0, 0, W, BAND, Blitbuffer.COLOR_BLACK)
    local dateW = 0
    if info.date and info.date ~= "" then
        local d = TextWidget:new{ text = info.date, face = Font:getFace("cfont", 20), bold = true, fgcolor = Blitbuffer.COLOR_WHITE }
        local ds = d:getSize()
        d:paintTo(bb, W - M - ds.w, math.floor((BAND - ds.h) / 2)); dateW = ds.w + 24; d:free()
    end
    local siteText = tostring(info.site or ""):gsub("^www%.", ""):upper()
    if siteText ~= "" then
        local sw = TextWidget:new{ text = siteText, face = Font:getFace("cfont", 20), bold = true, fgcolor = Blitbuffer.COLOR_WHITE,
            max_width = W - 2 * M - dateW, truncate_with_ellipsis = true }
        sw:paintTo(bb, M, math.floor((BAND - sw:getSize().h) / 2)); sw:free()
    end
    -- the title: as large as fits in its area
    local imageH = info.image and 330 or 0
    local titleTop, titleMax = 96, H - 96 - 80 - imageH - (info.image and 24 or 140)
    local size, title = 52
    while true do
        title = text(require("aishlib.epub").coverTitle(info.title, info.site), "tfont", size, W - 2 * M, { bold = true })
        if title:getSize().h <= titleMax or size <= 22 then break end
        title:free(); size = size - 4
    end
    if title:getSize().h > titleMax then title:free(); title = text(require("aishlib.epub").coverTitle(info.title, info.site), "tfont", size, W - 2 * M, { bold = true, height = titleMax }) end
    title:paintTo(bb, M, titleTop)
    local y = titleTop + title:getSize().h + 24
    title:free()
    if info.author and info.author ~= "" then
        local by = text(info.author, "cfont", 20, W - 2 * M, { color = Blitbuffer.COLOR_DARK_GRAY })
        by:paintTo(bb, M, y); y = y + by:getSize().h + 16; by:free()
    end
    -- the image (fitted, centred) or the start of the summary
    local drawn = false
    if info.image then
        local ok = pcall(function()
            local iw, ih = require("aishlib.imgsize").size(info.image)
            local boxW, boxH = W - 2 * M, H - 80 - y - 16
            local scale = math.min(boxW / iw, boxH / ih)
            local tw, th = math.floor(iw * scale), math.floor(ih * scale)
            local img = require("ui/renderimage"):renderImageData(info.image, #info.image, false, tw, th)
            if img then
                bb:blitFrom(img, M + math.floor((boxW - img:getWidth()) / 2), y + math.floor((boxH - img:getHeight()) / 2), 0, 0, img:getWidth(), img:getHeight())
                img:free(); drawn = true
            end
        end)
        if not ok then drawn = false end
    end
    if not drawn and info.summary and info.summary ~= "" then
        local sum = text(info.summary, "cfont", 22, W - 2 * M, { height = H - 80 - y - 16, color = Blitbuffer.COLOR_DARK_GRAY })
        sum:paintTo(bb, M, y); sum:free()
    end
    -- the foot
    bb:paintRect(M, H - 64, W - 2 * M, 2, Blitbuffer.COLOR_BLACK)
    -- the foot: the article's tags on the left (up to four, cut with "…" when long), Kaivo on the right
    local brand = TextWidget:new{ text = "Kaivo", face = Font:getFace("cfont", 18), bold = true }
    local bs = brand:getSize()
    brand:paintTo(bb, W - M - bs.w, H - 52); brand:free()
    local tags = {}
    for __, tg in ipairs(info.tags or {}) do
        if #tags < 4 then tags[#tags + 1] = "#" .. tostring(tg):gsub("%s+", "-") end
    end
    if #tags > 0 then
        local tw = TextWidget:new{ text = table.concat(tags, "   "), face = Font:getFace("cfont", 18), fgcolor = Blitbuffer.COLOR_DARK_GRAY,
            max_width = W - 2 * M - bs.w - 24, truncate_with_ellipsis = true }
        tw:paintTo(bb, M, H - 52); tw:free()
    end
    -- JPEG through TurboJPEG: many times faster than KOReader's PNG writer, and smaller
    util.makePath(dir)
    local ok = pcall(function()
        local ffi = require("ffi")
        local rgb = Blitbuffer.new(W, H, Blitbuffer.TYPE_BBRGB24)
        rgb:blitFrom(bb)
        local done, err = require("ffi/jpeg").encodeToFile(path, ffi.cast("uint8_t*", rgb.data), W, H, 3, 82, rgb.stride)
        rgb:free()
        assert(done, err)
    end)
    if not ok then bb:writePNG(path) end   -- older builds without the JPEG writer
    bb:free()
    return fs.read(path)
end

-- ── KOReader's highlights ───────────────────────────────────────────────────
local function koDate(iso)
    local y, mo, d, h, mi, sec = tostring(iso or ""):match("^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
    if y then return string.format("%s-%s-%s %s:%s:%s", y, mo, d, h, mi, sec) end
    return os.date("%Y-%m-%d %H:%M:%S")
end

--- Finds a Kaivo highlight in the open book: the whole quote (its saved context picks the place where it occurs more
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
        for __, r in ipairs(hits) do
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
    for __, a in ipairs(heads) do
        for __, b in ipairs(tails) do
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
        -- nothing to do when neither the book's sidecar nor the article's highlights and comments changed since last time
        local sidecar = DocSettings:findSidecarFile(st.file)
        local mtime = sidecar and lfs.attributes(sidecar, "modification") or 0
        local parts = {}
        for __, h in ipairs(hls) do
            parts[#parts + 1] = h.id .. ":" .. tostring(h.t) .. ":" .. tostring(h.dismissed) .. ":" .. tostring(o.gone[h.id])
            local c = comments[h.id]
            if c then parts[#parts + 1] = c.id .. ":" .. tostring(c.text) end
        end
        local sig = tostring(mtime) .. "|" .. table.concat(parts, ",")
        self.seen = self.seen or self.settings:readSetting("reconciled") or {}
        if self.seen[id] == sig then return nil end
        local ds = DocSettings:open(st.file)
        local items = ds:readSetting("annotations")
        if type(items) ~= "table" then
            if next(base) then return nil end   -- linked before, but no list now: not read as "all removed"
            items = {}
        end
        o.items = items
        act = Annots.reconcile(o)
        if act.removed + act.notesHere + #act.create > 0 then ds:saveSetting("annotations", items); ds:flush()
            mtime = sidecar and lfs.attributes(sidecar, "modification") or mtime
            sig = tostring(mtime) .. "|" .. table.concat(parts, ",")
        end
        self.seen[id] = sig
    end
    Annots.apply(lib, id, act, base)
    -- finished in KOReader → archived in Kaivo (once per finish: un-archiving in Kaivo is not undone here)
    local summary
    if ui then summary = ui.doc_settings and ui.doc_settings:readSetting("summary")
    else
        local st = lib.state[id]
        summary = st and DocSettings:hasSidecarFile(st.file) and DocSettings:open(st.file):readSetting("summary")
    end
    local done = type(summary) == "table" and summary.status == "complete"
    self:recordProgress(lib, id, ui, done)
    local sent = self.settings:readSetting("finished_sent") or {}
    if done and not sent[id] and self.settings:nilOrTrue("finished_archive") then
        local art = lib.article(id)
        if art and require("aishlib.json").val(art.values.archived) ~= true then lib.edit("article:" .. id, { archived = true }) end
        sent[id] = true; self.settings:saveSetting("finished_sent", sent)
    elseif not done and sent[id] then
        sent[id] = nil; self.settings:saveSetting("finished_sent", sent)
    end
    return act
end

--- How far the article was read on this reader → Kaivo (`progress`: the deepest point, only ever more; `finishedAt` from 90 % or when
--- KOReader marks the book finished, which also makes it read). The open book is measured from its page, a closed one from its sidecar.
local FINISHED_AT = 0.9
function AISH:recordProgress(lib, id, ui, done)
    local json = require("aishlib.json")
    local pct
    if ui and ui.document then
        local ok, p = pcall(function()
            local n, c = ui.document:getPageCount(), ui.document:getCurrentPage()
            if n and n > 0 and c then return c / n end
        end)
        pct = ok and p or nil
        if not pct and ui.doc_settings then pct = ui.doc_settings:readSetting("percent_finished") end
    else
        local st = lib.state[id]
        if st and DocSettings:hasSidecarFile(st.file) then pct = DocSettings:open(st.file):readSetting("percent_finished") end
    end
    pct = tonumber(pct)
    local art = lib.article(id)
    if not art then return end
    local changes, now = {}, nil
    local p = pct and pct > 0 and math.floor(math.min(1, pct) * 100 + 0.5) / 100 or nil
    local cur = tonumber(json.val(art.values.progress)) or 0
    if p and p > cur and (p - cur >= 0.02 or p >= FINISHED_AT) then changes.progress = p end   -- small steps stay here: no sync for every page
    if ((p or 0) >= FINISHED_AT or done) and not json.val(art.values.finishedAt) then now = lib.isoNow(); changes.finishedAt = now end
    if changes.finishedAt and not json.val(art.values.readAt) then changes.readAt = now end
    if next(changes) then lib.edit("article:" .. id, changes) end
end

--- Every Kaivo article: the open one through the reader, the others through their sidecars (only books opened before).
function AISH:reconcileAll(lib)
    local total = { added = 0 }
    self.gone = lib.goneHighlights()
    self.reconciling = true
    local openFile = normPath(self.ui and self.ui.document and self.ui.document.file)
    for id, st in pairs(lib.state) do
        local ok, act = pcall(self.reconcileArticle, self, lib, id, (openFile and st.file:gsub("//+", "/") == openFile) and self.ui or nil)
        if not ok then logger.warn("Kaivo: highlights of", st.file, act)
        elseif act then total.added = total.added + act.added end
    end
    self.gone = nil
    self.reconciling = false
    if self.seen then self.settings:saveSetting("reconciled", self.seen); self:save(); self.seen = nil end
    return total
end

--- Opening a Kaivo article: its highlights in step, and it counts as read in Kaivo.
function AISH:onReaderReady()
    local file = normPath(self.ui and self.ui.document and self.ui.document.file)
    if not file or not self:isConnected() then return end
    UIManager:nextTick(function()
        local ok, err = pcall(function()
            local lib = self:library()
            local id = lib.articleOfFile(file)
            if not id then return end
            self.open_article = id
            -- HTML files: the chapters (Summary · the article's headings · Key points · Notes) come from the headings
            -- (an EPUB brings its own table of contents)
            if file:find("%.html$") and self.ui.doc_settings and self.ui.doc_settings:hasNot("alternative_toc") and self.ui.document.canHaveAlternativeToc
                    and self.ui.document:canHaveAlternativeToc() then
                self.ui.doc_settings:makeTrue("alternative_toc")
                pcall(function() self.ui.toc:resetToc(); self.ui.toc:fillToc() end)
            end
            local art = lib.article(id)
            if art and not require("aishlib.json").val(art.values.readAt) then lib.edit("article:" .. id, { readAt = lib.isoNow() }) end
            self.reconciling = true
            self:reconcileArticle(lib, id, self.ui)
            lib.flush()
        end)
        self.reconciling = false
        if not ok then logger.warn("Kaivo: on open", err) end
    end)
end

--- A highlight or note made, changed or removed in an open Kaivo article: linked to Kaivo right away, so the link is saved
--- with the book's own settings (our own changes raise this event too: ignored).
function AISH:onAnnotationsModified()
    if not self.open_article or self.reconciling then return end
    if self.reconcile_scheduled then return end
    self.reconcile_scheduled = true
    UIManager:nextTick(function()
        self.reconcile_scheduled = false
        if not self.open_article or not (self.ui and self.ui.document) then return end
        self.reconciling = true
        local ok, err = pcall(function() local lib = self:library(); self:reconcileArticle(lib, self.open_article, self.ui); lib.flush() end)
        self.reconciling = false
        if not ok then logger.warn("Kaivo: highlights", err) end
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
        lib.flush()
        self.reconciling = false
        local pending = lib.pendingCount()
        self.settings:saveSetting("pending", pending); self:save()
        if pending > 0 and self.settings:nilOrTrue("send_on_close") and not self:isLocked() and not shared.syncing then
            -- after the book is closed, from the file browser's instance (this one goes with the book); offline, the
            -- changes wait: Wi-Fi coming on sends them (onNetworkConnected), whatever the 30 minutes
            UIManager:scheduleIn(1, function()
                local runner = shared.browser or self
                if shared.syncing or not NetworkMgr:isOnline() then return end
                runner.quiet = true
                runner:sync()
            end)
        end
    end)
    self.reconciling = false
    if not ok then logger.warn("Kaivo: on close", err) end
end

--- An article deleted in Kaivo: the file, KOReader's sidecar for it, and its place in history and collections.
function AISH:removeArticle(path)
    os.remove(path)
    pcall(function() DocSettings.updateLocation(path) end)
    pcall(function() require("readhistory"):fileDeleted(path) end)
    pcall(function() require("readcollection"):removeItem(path) end)
end

--- Kaivo collections → KOReader collections "Kaivo: <name>", for the files this plugin made (others are never touched).
--[[--
KOReader collections for the files this plugin made (other files are never touched), each newest first:
  "Kaivo · Inbox" / "Kaivo · Read" / "Kaivo · Archive"   the Kaivo tabs (not read yet / read / archived)
  "Kaivo: <name>"                                         your Kaivo collections
  "Kaivo #<tag>"                                          the 10 most used tags
]]
function AISH:updateCollections(m, ourFiles)
    local ok, err = pcall(function()
        local RC = require("readcollection")
        local real = function(p) return ffiUtil.realpath(p) or p end
        local tsOf = {}
        for __, list in pairs(m.tabs) do for __, it in ipairs(list) do tsOf[it.file] = it.ts end end
        local want = {}   -- collection → files, newest first
        want[TAB_PREFIX .. _("Inbox")], want[TAB_PREFIX .. _("Read")], want[TAB_PREFIX .. _("Archive")] = {}, {}, {}
        for __, it in ipairs(m.tabs.inbox) do table.insert(want[TAB_PREFIX .. _("Inbox")], it.file) end
        for __, it in ipairs(m.tabs.read) do table.insert(want[TAB_PREFIX .. _("Read")], it.file) end
        for __, it in ipairs(m.tabs.archive) do table.insert(want[TAB_PREFIX .. _("Archive")], it.file) end
        for file, names in pairs(m.collections) do
            for __, n in ipairs(names) do
                local cn = COLL_PREFIX .. n
                want[cn] = want[cn] or {}
                table.insert(want[cn], file)
            end
        end
        local tagNames = {}
        for tg, list in pairs(m.tags) do tagNames[#tagNames + 1] = { name = tg, n = #list } end
        table.sort(tagNames, function(x, y) return x.n > y.n or (x.n == y.n and x.name:lower() < y.name:lower()) end)
        if self.settings:nilOrTrue("tag_collections") then
            for i = 1, math.min(TOP_TAGS, #tagNames) do
                local cn = TAG_PREFIX .. tagNames[i].name
                want[cn] = {}
                for __, it in ipairs(m.tags[tagNames[i].name]) do table.insert(want[cn], it.file) end
            end
        end
        local function ourColl(cn) return isOurName(cn) end
        local ours = {}
        for __, f in ipairs(ourFiles) do ours[real(f)] = true end
        local touched = {}
        for cn, files in pairs(want) do
            table.sort(files, function(x, y) return (tsOf[x] or "") > (tsOf[y] or "") end)
            if not RC.coll[cn] then RC:addCollection(cn); touched[cn] = true end
            local set = {}
            for __, f in ipairs(files) do set[f] = true end
            if RC:addItemsMultiple(set, { [cn] = true }) > 0 then touched[cn] = true end
            local coll, keep = RC.coll[cn], {}
            for i, f in ipairs(files) do
                local rf = real(f)
                keep[rf] = true
                if coll[rf] and coll[rf].order ~= i then coll[rf].order = i; touched[cn] = true end   -- newest first
            end
            for f in pairs(coll) do   -- an article that left it (read, archived, removed from the collection) leaves here too
                if ours[f] and not keep[f] then coll[f] = nil; touched[cn] = true end
            end
        end
        local gone = {}
        for cn in pairs(RC.coll) do
            if ourColl(cn) and not want[cn] then   -- a Kaivo collection or tag that is no longer there
                local foreign = false
                for f in pairs(RC.coll[cn]) do if not ours[f] then foreign = true end end
                if not foreign then gone[#gone + 1] = cn end
            end
        end
        for __, cn in ipairs(gone) do RC:removeCollection(cn); touched[cn] = true end
        if next(touched) then RC:write(touched) end
        self.inbox = want[TAB_PREFIX .. _("Inbox")]
    end)
    if not ok then logger.warn("Kaivo: collections not updated", err) end
end

return AISH
