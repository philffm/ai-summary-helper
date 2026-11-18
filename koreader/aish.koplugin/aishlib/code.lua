--[[--
The connection code the extension shows ("Connect a phone"), and passphrase spelling.

    aish-library://v1?k=webdav&u=<address>&n=<user>&p=<app password>&r=<folder>[&w=<words>]

Same format as plugin/src/modules/syncPhoneCode.js and the Android app (checked against sync-vector.json).

@module aishlib.code
]]
local M = {}

local function urlDecode(s)
    return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

--- Code text → { kind, url, username, password, root, words?, region?, bucket? }, or nil.
function M.parse(text)
    local q = tostring(text or ""):match("^%s*aish%-library://v1%?(.-)%s*$")
    if not q or q == "" then return nil end
    local v = {}
    for part in q:gmatch("[^&]+") do
        local k, val = part:match("^([^=]+)=(.*)$")
        if k then v[k] = urlDecode(val) end
    end
    if v.k ~= "webdav" and v.k ~= "s3" then return nil end
    local out = { kind = v.k, url = v.u or "", username = v.n or "", password = v.p or "", root = v.r or "aish-sync" }
    if v.k == "s3" then out.region = v.g or "us-east-1"; out.bucket = v.b or "" end
    if v.w and v.w ~= "" then out.words = v.w end
    return out
end

local SET
local function words()
    if not SET then
        SET = {}
        for w in require("aishlib.wordlist"):gmatch("%a+") do SET[w] = true end
    end
    return SET
end

--- A phrase of four or more list words in any spelling (dashes, commas, case) → the words joined by single spaces;
--- anything else (an own passphrase) exactly as typed. The same rule as canonicalPassphrase() in the extension.
function M.canonicalPassphrase(input)
    local text = tostring(input or "")
    local parts = {}
    for p in text:lower():gmatch("[^%s,;%-]+") do parts[#parts + 1] = p end
    if #parts < 4 then return text end
    local set = words()
    for _, p in ipairs(parts) do if not set[p] then return text end end
    return table.concat(parts, " ")
end

return M
