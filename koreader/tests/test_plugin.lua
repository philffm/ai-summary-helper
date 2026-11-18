-- Run by interop.sh (skipped otherwise): main.lua inside a stand-in for KOReader's modules. Connects with a code file in the
-- home folder, syncs from the WebDAV server (the place as the interop test left it: 2 articles, one in "Exam prep"), fills the KOReader collection, and syncs again with the kept key.
if os.getenv("AISH_PHASE") ~= "plugin" then return end
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
package.path = here .. "/../aish.koplugin/?.lua;" .. here .. "/?.lua;" .. package.path
local fsu = require("fsutil")
local work = os.getenv("AISH_WORK") .. "-plugin"
local home = work .. "/home"
fsu.mkdirp(home); fsu.mkdirp(work .. "/settings"); fsu.mkdirp(work .. "/data")

local shown, flushed = {}, {}
local function mod(name, v) package.loaded[name] = v end
local function widget(kind) return { new = function(_, o) o = o or {}; o.kind = kind; o.onShowKeyboard = function() end; return o end } end
local settingsStore = {}
local LuaSettings = { open = function(_, path)
    settingsStore[path] = settingsStore[path] or {}
    local data = settingsStore[path]
    return { data = data, readSetting = function(_, k) return data[k] end, saveSetting = function(_, k, v) data[k] = v end,
        delSetting = function(_, k) data[k] = nil end, flush = function() flushed[path] = true end, isTrue = function(_, k) return data[k] == true end }
end }
_G.G_reader_settings = LuaSettings:open("global"); G_reader_settings:saveSetting("home_dir", home)
mod("datastorage", { getSettingsDir = function() return work .. "/settings" end, getDataDir = function() return work .. "/data" end })
mod("dispatcher", { registerAction = function() end })
mod("docsettings", { updateLocation = function() end })
mod("ui/widget/infomessage", widget("info")); mod("ui/widget/inputdialog", widget("input")); mod("ui/widget/confirmbox", widget("confirm"))
mod("ui/widget/multiinputdialog", widget("multi")); mod("luasettings", LuaSettings)
mod("ui/network/manager", { runWhenOnline = function(_, cb) cb() end })
mod("ui/uimanager", { show = function(_, w) shown[#shown + 1] = w end, close = function() end, forceRePaint = function() end, nextTick = function(_, cb) cb() end })
mod("ui/widget/container/widgetcontainer", { extend = function(_, o) o.__index = o; return setmetatable(o, {}) end })
mod("ffi/util", { template = function(s, ...) local a = { ... }; return (s:gsub("%%(%d)", function(i) return tostring(a[tonumber(i)]) end)) end,
    realpath = function(p) return p end, purgeDir = function(d) os.execute("rm -rf '" .. d .. "'") end })
mod("libs/libkoreader-lfs", { attributes = function(p, what)
    if fsu.exists(p) then return "file" end
    return os.execute("test -d '" .. p .. "'") == 0 and "directory" or nil end })
mod("logger", { info = function() end, warn = print, err = print, dbg = function() end })
mod("socketutil", { set_timeout = function() end, reset_timeout = function() end, FILE_BLOCK_TIMEOUT = 15, FILE_TOTAL_TIMEOUT = 60 })
mod("util", { makePath = fsu.mkdirp, trim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end })
mod("gettext", function(s) return s end)
local RC = { coll = {}, writes = 0 }
function RC:addCollection(n) self.coll[n] = {} end
function RC:addItemsMultiple(files, colls) local c = 0; for f in pairs(files) do for n in pairs(colls) do if not self.coll[n][f] then self.coll[n][f] = { file = f }; c = c + 1 end end end return c end
function RC:write() self.writes = self.writes + 1 end
function RC:removeItem() end
mod("readcollection", RC); mod("readhistory", { fileDeleted = function() end })
mod("apps/filemanager/filemanager", { instance = nil }); mod("apps/filemanager/filemanagerutil", { getDefaultDir = function() return home end })

local AISH = require("main")
local menu = {}
local plugin = setmetatable({ ui = { menu = { registerToMainMenu = function(_, p) p:addToMainMenu(menu) end } } }, { __index = AISH })
plugin:init()
assert(menu.aish_library and #menu.aish_library.sub_item_table == 7, "menu")
assert(menu.aish_library.sub_item_table[3].text_func() == "Not connected")

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
local s = settingsStore[work .. "/settings/aish.lua"]
assert(s.master and #s.master == 64 and s.salt and not s.passphrase, "the key is kept, the passphrase is not")
assert(menu.aish_library.sub_item_table[3].text_func():find("2 articles"), "status line")

-- second sync: the kept key opens the place (no passphrase), nothing new
shown = {}
plugin:syncNow()
assert(shown[#shown].text:find("0 new or updated, 0 removed", 1, true), shown[#shown].text)
for _, w in ipairs(shown) do assert(w.kind ~= "input", "no passphrase asked") end

-- a wrong kept key (place made anew elsewhere) asks for the passphrase instead of failing
s.master = string.rep("00", 32)
shown = {}
plugin:syncNow()
local asked = false
for _, w in ipairs(shown) do if w.kind == "input" and w.title:find("Passphrase") then asked = true end end
assert(asked, "asks for the passphrase when the kept key no longer opens the place")
print("TEST plugin OK")
