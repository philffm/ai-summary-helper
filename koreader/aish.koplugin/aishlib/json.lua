--[[--
JSON for the plugin: KOReader's rapidjson when present (fast with long articles), else its `json` module; outside KOReader
(the tests) cjson or dkjson. decode() never throws: nil, reason.

@module aishlib.json
]]
local M = {}
local impl
for _, name in ipairs({ "rapidjson", "cjson", "json", "dkjson" }) do
    local ok, mod = pcall(require, name)
    if ok and type(mod) == "table" and mod.decode then impl = mod; break end
end
assert(impl, "no JSON library")
M.null = impl.null

--- JavaScript strings may hold lone UTF-16 surrogates, and JSON.stringify writes them as \ud800-style escapes that strict
--- decoders refuse. Only when a decode fails, such escapes are replaced by U+FFFD and the text is decoded again.
local function fixSurrogates(text)
    local out, i, n = {}, 1, #text
    local function hi(h) return h >= 0xD800 and h <= 0xDBFF end
    local function lo(h) return h >= 0xDC00 and h <= 0xDFFF end
    while true do
        local s = text:find("\\", i, true)
        if not s then out[#out + 1] = text:sub(i); break end
        local c = text:sub(s + 1, s + 1)
        if c ~= "u" then out[#out + 1] = text:sub(i, s + 1); i = s + 2
        else
            local h = tonumber(text:sub(s + 2, s + 5), 16) or 0
            if hi(h) then
                local nxt = text:sub(s + 6, s + 7) == "\\u" and tonumber(text:sub(s + 8, s + 11), 16)
                if nxt and lo(nxt) then out[#out + 1] = text:sub(i, s + 11); i = s + 12
                else out[#out + 1] = text:sub(i, s - 1) .. "\\ufffd"; i = s + 6 end
            elseif lo(h) then out[#out + 1] = text:sub(i, s - 1) .. "\\ufffd"; i = s + 6
            else out[#out + 1] = text:sub(i, s + 5); i = s + 6 end
        end
        if i > n then break end
    end
    return table.concat(out)
end

function M.decode(text)
    local ok, v = pcall(impl.decode, text)
    if ok then return v end
    ok, v = pcall(impl.decode, fixSurrogates(text))
    if not ok then return nil, tostring(v) end
    return v
end
function M.encode(v) return impl.encode(v) end
--- JSON null (or a missing value) → nil
function M.val(v) if v == nil or v == M.null then return nil end return v end
return M
