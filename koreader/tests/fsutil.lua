-- The file helpers the library needs, for the tests (the plugin itself uses KOReader's lfs).
local M = {}
local function q(p) return "'" .. p:gsub("'", "'\\''") .. "'" end
function M.mkdirp(p) os.execute("mkdir -p " .. q(p)) end
function M.exists(p) local f = io.open(p, "rb"); if f then f:close(); return true end return false end
function M.read(p) local f = io.open(p, "rb"); if not f then return nil end local s = f:read("*a"); f:close(); return s end
function M.write(p, s) local f = assert(io.open(p .. ".tmp", "wb")); f:write(s); f:close(); assert(os.rename(p .. ".tmp", p)) end
function M.remove(p) os.remove(p) end
function M.touch(p, t) os.execute("touch -d @" .. math.floor(t) .. " " .. q(p)) end
function M.mtime(p) local h = io.popen("stat -c %Y " .. q(p) .. " 2>/dev/null"); local v = tonumber(h:read("*a")); h:close(); return v end
function M.ls(dir) local out = {}; local h = io.popen("ls -1 " .. q(dir) .. " 2>/dev/null"); for l in h:lines() do out[#out + 1] = l end h:close(); return out end
return M
