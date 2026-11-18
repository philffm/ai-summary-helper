--[[--
JSON as the extension writes and reads it.

  decode(text)  → value, or nil, reason. Arrays and objects keep their kind (metatables ARRAY / OBJECT), so [] and {} stay
                  apart: record hashes and merges must see the same value the extension saw. JSON null → json.null.
                  A lone UTF-16 surrogate (JavaScript strings may hold one) becomes its WTF-8 bytes, so it hashes like in JS.
  encode(value) → JSON text, like JSON.stringify: same escapes, same number format.

Pure Lua: KOReader's JSON libraries cannot tell [] from {}.

@module aishlib.json
]]
local M = {}

local ARRAY = { __jsontype = "array" }
local OBJECT = { __jsontype = "object" }
M.ARRAY, M.OBJECT = ARRAY, OBJECT
M.null = setmetatable({}, { __tostring = function() return "null" end, __jsontype = "null" })

function M.array(t) return setmetatable(t or {}, ARRAY) end
function M.object(t) return setmetatable(t or {}, OBJECT) end
function M.isArray(t)
    if type(t) ~= "table" then return false end
    local mt = getmetatable(t)
    if mt == ARRAY then return true end
    if mt == OBJECT then return false end
    if next(t) == nil then return false end   -- an untyped empty table is an object
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" then return false end
        n = n + 1
    end
    return n == #t
end
--- JSON null (or a missing value) → nil
function M.val(v) if v == nil or v == M.null then return nil end return v end

-- ── decode ──────────────────────────────────────────────────────────────────
local function utf8(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40) end
    if cp < 0x10000 then return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40) end
    return string.char(0xF0 + math.floor(cp / 0x40000), 0x80 + math.floor(cp / 0x1000) % 0x40, 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end
M.utf8char = utf8
local ESC = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

function M.decode(text)
    if type(text) ~= "string" then return nil, "not text" end
    local pos = 1
    local value
    local function fail(msg) error({ json = msg .. " at " .. pos }) end
    local function ws() pos = text:find("[^ \t\r\n]", pos) or (#text + 1) end
    local function str()
        pos = pos + 1   -- opening quote
        local parts = {}
        while true do
            local s, e = text:find('["\\]', pos)
            if not s then fail("unterminated string") end
            if s > pos then parts[#parts + 1] = text:sub(pos, s - 1) end
            if text:sub(s, s) == '"' then pos = s + 1; break end
            local c = text:sub(s + 1, s + 1)
            if c == "u" then
                local h = tonumber(text:sub(s + 2, s + 5), 16)
                if not h then fail("bad \\u escape") end
                pos = s + 6
                if h >= 0xD800 and h <= 0xDBFF and text:sub(pos, pos + 1) == "\\u" then
                    local l = tonumber(text:sub(pos + 2, pos + 5), 16)
                    if l and l >= 0xDC00 and l <= 0xDFFF then
                        h = 0x10000 + (h - 0xD800) * 0x400 + (l - 0xDC00); pos = pos + 6
                    end
                end
                parts[#parts + 1] = utf8(h)   -- a lone surrogate: its WTF-8 bytes
            else
                local r = ESC[c]
                if not r then fail("bad escape") end
                parts[#parts + 1] = r; pos = s + 2
            end
        end
        return table.concat(parts)
    end
    function value()
        ws()
        local c = text:sub(pos, pos)
        if c == "{" then
            pos = pos + 1
            local obj = setmetatable({}, OBJECT)
            ws()
            if text:sub(pos, pos) == "}" then pos = pos + 1; return obj end
            while true do
                ws()
                if text:sub(pos, pos) ~= '"' then fail("expected a key") end
                local k = str()
                ws()
                if text:sub(pos, pos) ~= ":" then fail("expected :") end
                pos = pos + 1
                obj[k] = value()
                ws()
                local d = text:sub(pos, pos); pos = pos + 1
                if d == "}" then return obj end
                if d ~= "," then fail("expected , or }") end
            end
        elseif c == "[" then
            pos = pos + 1
            local arr = setmetatable({}, ARRAY)
            ws()
            if text:sub(pos, pos) == "]" then pos = pos + 1; return arr end
            local n = 0
            while true do
                n = n + 1; arr[n] = value()
                ws()
                local d = text:sub(pos, pos); pos = pos + 1
                if d == "]" then return arr end
                if d ~= "," then fail("expected , or ]") end
            end
        elseif c == '"' then return str()
        elseif text:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
        elseif text:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
        elseif text:sub(pos, pos + 3) == "null" then pos = pos + 4; return M.null
        else
            local num = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
            if not num or num == "" then fail("unexpected character") end
            pos = pos + #num
            return tonumber(num)
        end
    end
    local ok, v = pcall(function()
        local r = value()
        ws()
        if pos <= #text then fail("trailing text") end
        return r
    end)
    if ok then return v end
    return nil, type(v) == "table" and v.json or tostring(v)
end

-- ── encode ──────────────────────────────────────────────────────────────────
--- A number as JavaScript prints it (JSON.stringify / String(n)).
function M.number(n)
    if n ~= n or n == math.huge or n == -math.huge then return "null" end
    if n == math.floor(n) and math.abs(n) < 1e21 then return string.format("%.0f", n) end
    local s
    for p = 1, 17 do
        s = string.format("%." .. p .. "g", n)
        if tonumber(s) == n then break end
    end
    -- %g → JS: exponent form only below 1e-6 or from 1e21, and as "1e-7" / "1.5e+21"
    local mant, exp = s:match("^(-?[%d%.]+)e([-+]%d+)$")
    if mant then
        local e = tonumber(exp)
        if e >= -7 + 1 and e < 21 then
            -- write it out in full
            local neg = mant:sub(1, 1) == "-"
            local digits = mant:gsub("^-", ""):gsub("%.", "")
            local intLen = #(mant:gsub("^-", ""):match("^(%d+)")) + e
            local out
            if intLen <= 0 then out = "0." .. string.rep("0", -intLen) .. digits
            elseif intLen >= #digits then out = digits .. string.rep("0", intLen - #digits)
            else out = digits:sub(1, intLen) .. "." .. digits:sub(intLen + 1) end
            return (neg and "-" or "") .. out
        end
        return mant .. "e" .. (e >= 0 and "+" or "-") .. tostring(math.abs(e))
    end
    return s
end

-- the UTF-16 view of a UTF-8 (WTF-8) string: { code units }
function M.utf16(s)
    local out, n, i, len = {}, 0, 1, #s
    while i <= len do
        local c = s:byte(i)
        local cp, size
        if c < 0x80 then cp, size = c, 1
        elseif c >= 0xF0 and i + 3 <= len then cp = (c % 0x08) * 0x40000 + (s:byte(i + 1) % 0x40) * 0x1000 + (s:byte(i + 2) % 0x40) * 0x40 + s:byte(i + 3) % 0x40; size = 4
        elseif c >= 0xE0 and i + 2 <= len then cp = (c % 0x10) * 0x1000 + (s:byte(i + 1) % 0x40) * 0x40 + s:byte(i + 2) % 0x40; size = 3
        elseif c >= 0xC0 and i + 1 <= len then cp = (c % 0x20) * 0x40 + s:byte(i + 1) % 0x40; size = 2
        else cp, size = 0xFFFD, 1 end
        if cp >= 0x10000 then
            cp = cp - 0x10000
            n = n + 1; out[n] = 0xD800 + math.floor(cp / 0x400)
            n = n + 1; out[n] = 0xDC00 + cp % 0x400
        else n = n + 1; out[n] = cp end
        i = i + size
    end
    return out
end

local SHORT = { [0x22] = '\\"', [0x5C] = "\\\\", [0x08] = "\\b", [0x0C] = "\\f", [0x0A] = "\\n", [0x0D] = "\\r", [0x09] = "\\t" }
--- A string as JSON.stringify writes it (control characters and lone surrogates escaped, the rest as is).
function M.quote(s)
    if not s:find('[%c"\\\237]') then return '"' .. s .. '"' end
    local out = { '"' }
    local i, len = 1, #s
    while i <= len do
        local c = s:byte(i)
        if SHORT[c] then out[#out + 1] = SHORT[c]; i = i + 1
        elseif c < 0x20 then out[#out + 1] = string.format("\\u%04x", c); i = i + 1
        elseif c == 0xED and i + 2 <= len and s:byte(i + 1) >= 0xA0 then   -- a lone surrogate (WTF-8)
            local cp = 0xD000 + (s:byte(i + 1) % 0x40) * 0x40 + s:byte(i + 2) % 0x40
            out[#out + 1] = string.format("\\u%04x", cp); i = i + 3
        else
            local j = s:find('[%c"\\\237]', i) or (len + 1)
            if j == i then j = i + 1 end
            out[#out + 1] = s:sub(i, j - 1); i = j
        end
    end
    out[#out + 1] = '"'
    return table.concat(out)
end

--- JSON.stringify(value). Object keys in insertion order are not known in Lua: they are sorted (the extension compares
--- records by content, never by key order).
function M.encode(v)
    local t = type(v)
    if v == nil or v == M.null then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then return M.number(v) end
    if t == "string" then return M.quote(v) end
    if t ~= "table" then error("cannot encode " .. t) end
    local parts = {}
    if M.isArray(v) then
        for i = 1, #v do parts[i] = M.encode(v[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k, x in pairs(v) do if type(k) == "string" and x ~= nil then keys[#keys + 1] = k end end
    table.sort(keys)
    for i, k in ipairs(keys) do parts[i] = M.quote(k) .. ":" .. M.encode(v[k]) end
    return "{" .. table.concat(parts, ",") .. "}"
end

return M
