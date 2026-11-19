--[[--
Stamps and merges of sync records, the same rules as the extension (plugin/src/modules/syncStamps.js, syncMerge.js) and the
Android app; checked against hashValues and mergeCases in plugin/tests/fixtures/sync-vector.json.

A record: { rev = { t, d }, f = { field = { t, h } }, values = { field = value }, deleted? }
  t  time stamp (ms, never below what this device has seen), d  device id (tie-break), h  hash of the field's value.

@module aishlib.stamps
]]
local bit = require("bit")
local json = require("aishlib.json")

local M = {}

-- ── hashing (cyrb53 over the UTF-16 code units of a canonical JSON) ──────────
local function sortedKeys(t)
    local keys = {}
    for k, v in pairs(t) do if type(k) == "string" and v ~= nil then keys[#keys + 1] = k end end
    -- JavaScript sorts by UTF-16 code units; UTF-8 byte order differs only between astral and U+E000–U+FFFF characters
    table.sort(keys)
    return keys
end

function M.canonical(v)
    if v == nil then return "u" end
    local t = type(v)
    if v == json.null or t ~= "table" then return json.encode(v) end
    local parts = {}
    if json.isArray(v) then
        for i = 1, #v do parts[i] = M.canonical(v[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for i, k in ipairs(sortedKeys(v)) do parts[i] = json.quote(k) .. ":" .. M.canonical(v[k]) end
    return "{" .. table.concat(parts, ",") .. "}"
end

local tobit, bxor, rshift, band, lshift = bit.tobit, bit.bxor, bit.rshift, bit.band, bit.lshift
local function imul(a, b)   -- Math.imul: the low 32 bits of a 32×32 product, signed
    a, b = tobit(a), tobit(b)
    local ah, al, bh, bl = rshift(a, 16), band(a, 0xffff), rshift(b, 16), band(b, 0xffff)
    return tobit(al * bl + lshift(tobit(ah * bl + al * bh), 16))
end
local function u32(x) x = tobit(x); return x < 0 and x + 4294967296 or x end
local B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
local function base36(n)
    if n == 0 then return "0" end
    local out = {}
    while n > 0 do
        local r = n % 36
        table.insert(out, 1, B36:sub(r + 1, r + 1))
        n = (n - r) / 36
    end
    return table.concat(out)
end

function M.hashValue(v)
    local units = json.utf16(M.canonical(v))
    local h1, h2 = tobit(0xdeadbeef), tobit(0x41c6ce57)
    for i = 1, #units do
        local c = units[i]
        h1 = imul(bxor(h1, c), 2654435761)
        h2 = imul(bxor(h2, c), 1597334677)
    end
    h1 = bxor(imul(bxor(h1, rshift(h1, 16)), 2246822507), imul(bxor(h2, rshift(h2, 13)), 3266489909))
    h2 = bxor(imul(bxor(h2, rshift(h2, 16)), 2246822507), imul(bxor(h1, rshift(h1, 13)), 3266489909))
    return base36(4294967296 * band(h2, 2097151) + u32(h1))
end

-- ── clock ───────────────────────────────────────────────────────────────────
--- A new stamp: the wall clock, but above everything this device has stamped or seen. Mutates clock ({ t }).
function M.tick(clock, now)
    clock.t = math.max(tonumber(now) or 0, (clock.t or 0) + 1)
    return clock.t
end
function M.observe(clock, t)
    if type(t) == "number" and t > (clock.t or 0) then clock.t = t end
end

function M.compareRev(a, b)
    local x, y = a or { t = 0, d = "" }, b or { t = 0, d = "" }
    local xt, yt = tonumber(x.t) or 0, tonumber(y.t) or 0
    if xt ~= yt then return xt - yt end
    local xd, yd = tostring(x.d or ""), tostring(y.d or "")
    return xd < yd and -1 or (xd > yd and 1 or 0)
end

-- ── merge (syncMerge.js) ────────────────────────────────────────────────────
local function deepcopy(x)
    if type(x) ~= "table" or x == json.null then return x end
    local out = setmetatable({}, getmetatable(x))
    for k, v in pairs(x) do out[k] = deepcopy(v) end
    return out
end
M.copy = deepcopy

local function same(x, y)
    return M.hashValue(json.array({ x.rev, x.f, x.values, x.deleted == true })) == M.hashValue(json.array({ y.rev, y.f, y.values, y.deleted == true }))
end

--- → merged, changedLocal, changedRemote. `localRec` may be nil (unknown here).
M.MAX_FIELDS = { progress = true }   -- the same list as MAX_FIELDS in the extension's syncMerge.js

function M.mergeRecord(localRec, remote)
    if not localRec then return deepcopy(remote), true, false end
    if not remote then return deepcopy(localRec), false, true end
    if localRec.deleted or remote.deleted then
        local c = M.compareRev(localRec.rev, remote.rev)
        local winner
        if localRec.deleted and remote.deleted then winner = c >= 0 and localRec or remote
        elseif c == 0 then winner = localRec.deleted and localRec or remote
        else winner = c > 0 and localRec or remote end
        local merged = deepcopy(winner)
        local function diff(a, b) return (a.deleted == true) ~= (b.deleted == true) or M.compareRev(a.rev, b.rev) ~= 0 end
        return merged, diff(merged, localRec), diff(merged, remote)
    end
    local f, values = json.object(), json.object()
    local names, seen = {}, {}
    for _, rec in ipairs({ localRec, remote }) do
        for name in pairs(rec.f or {}) do if not seen[name] then seen[name] = true; names[#names + 1] = name end end
    end
    local lf, rf = localRec.f or {}, remote.f or {}
    local lv, rv = localRec.values or {}, remote.values or {}
    local top = 0
    for _, name in ipairs(names) do
        local l, r = lf[name], rf[name]
        local pick
        if l and not r then pick = "local" elseif r and not l then pick = "remote"
        elseif l.h == r.h then pick = "local"
        elseif M.MAX_FIELDS[name] and type(lv[name]) == "number" and type(rv[name]) == "number" and lv[name] ~= rv[name] then
            pick = lv[name] > rv[name] and "local" or "remote"   -- the larger number wins (how far an article was read only grows)
        else
            pick = M.compareRev({ t = l.t or 0, d = (localRec.rev or {}).d or "" }, { t = r.t or 0, d = (remote.rev or {}).d or "" }) >= 0 and "local" or "remote"
        end
        local src, sv = pick == "local" and l or r, pick == "local" and lv or rv
        f[name] = json.object({ t = src.t, h = src.h })
        if sv[name] ~= nil then values[name] = deepcopy(sv[name]) end
        if l and r and l.h == r.h and (l.t or 0) > (r.t or 0) then f[name] = json.object({ t = r.t, h = r.h }) end   -- converge on the earlier stamp
        if (f[name].t or 0) > top then top = f[name].t end
    end
    local dev = (M.compareRev(localRec.rev, remote.rev) >= 0 and localRec or remote).rev.d
    local merged = { rev = json.object({ t = top, d = dev }), f = f, values = values }
    return merged, not same(merged, localRec), not same(merged, remote)
end

-- ── local edits ─────────────────────────────────────────────────────────────
--[[--
Sets fields of a record as an edit on this device: each field whose value changed gets a new stamp; a nil value removes the
field (it keeps a stamp, so the removal wins over older values elsewhere). Returns the record and whether it changed.
`rec` may be nil (a new record). ctx = { clock, now, device }
]]
function M.edit(rec, changes, ctx)
    rec = rec and deepcopy(rec) or { rev = json.object({ t = 0, d = ctx.device }), f = json.object(), values = json.object() }
    if rec.deleted then rec = { rev = rec.rev, f = json.object(), values = json.object() } end   -- a new save after a deletion
    rec.f = rec.f or json.object(); rec.values = rec.values or json.object()
    local t, changed = nil, false
    local names = {}
    for name in pairs(changes) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
        local v = changes[name]
        if v == json.null then v = nil end
        local h = M.hashValue(v)
        local cur = rec.f[name]
        if not (cur and cur.h == h) and not (not cur and v == nil) then
            t = t or M.tick(ctx.clock, ctx.now)
            rec.f[name] = json.object({ t = t, h = h })
            rec.values[name] = deepcopy(v)
            changed = true
        end
    end
    if changed then
        local top = 0
        for _, x in pairs(rec.f) do if (x.t or 0) > top then top = x.t end end
        rec.rev = json.object({ t = top, d = ctx.device })
    end
    return rec, changed
end

--- The deletion marker of a record (only for a real deletion made on this device).
function M.tombstone(ctx)
    return { rev = json.object({ t = M.tick(ctx.clock, ctx.now), d = ctx.device }), f = json.object(), values = json.object(), deleted = true }
end

return M
