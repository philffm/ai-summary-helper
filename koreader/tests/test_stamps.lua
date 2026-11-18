-- Hashes and merges agree with the extension: hashValues and mergeCases in plugin/tests/fixtures/sync-vector.json.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
local json, S = require("aishlib.json"), require("aishlib.stamps")
local f = assert(io.open(here .. "/../../plugin/tests/fixtures/sync-vector.json", "rb")); local vec = assert(json.decode(f:read("*a"))); f:close()
for _, c in ipairs(vec.hashValues) do
    local v = c.value
    local got = S.hashValue(v)
    assert(got == c.hash, "hash of " .. json.encode(v) .. ": " .. got .. " ≠ " .. c.hash)
end
for _, c in ipairs(vec.mergeCases) do
    local m, cl, cr = S.mergeRecord(c["local"], c.remote)
    assert(S.canonical(m) == S.canonical(c.merged), c.name .. ":\n  got  " .. S.canonical(m) .. "\n  want " .. S.canonical(c.merged))
    assert(cl == c.changedLocal and cr == c.changedRemote, c.name .. ": changed flags " .. tostring(cl) .. "/" .. tostring(cr))
end
-- JSON round trip keeps [] and {} apart, escapes like JSON.stringify, numbers like JavaScript
assert(json.encode(json.decode('{"a":[],"b":{},"c":[1,{"d":null}]}')) == '{"a":[],"b":{},"c":[1,{"d":null}]}')
assert(json.encode("quote \" back \\ tab \t nl \n bell \7 \226\128\168") == '"quote \\" back \\\\ tab \\t nl \\n bell \\u0007 \226\128\168"')
assert(json.encode(json.decode('"\\ud800 x"')) == '"\\ud800 x"', "lone surrogate survives")
assert(json.encode(json.decode('"\\ud83c\\udf0d"')) == '"\240\159\140\141"', "pair → one character")
for n, s in pairs({ [0.1] = "0.1", [1.5] = "1.5", [-7] = "-7", [1e21] = "1e+21", [1e-7] = "1e-7", [0.000001] = "0.000001", [123456789012] = "123456789012", [1.5e-10] = "1.5e-10", [2.5e25] = "2.5e+25" }) do
    assert(json.number(n) == s, "number " .. s .. " → " .. json.number(n))
end
-- edits stamp only what changed; a removal keeps a stamp
local ctx = { clock = { t = 0 }, now = 1700000000000, device = "ko-test" }
local r, ch = S.edit(nil, { text = "a", type = "user" }, ctx)
assert(ch and r.f.text.t == 1700000000000 and r.values.text == "a" and r.rev.d == "ko-test")
local r2, ch2 = S.edit(r, { text = "a" }, ctx); assert(not ch2, "same value: no change")
ctx.now = 1700000000005
local r3 = S.edit(r, { text = json.null }, ctx)
assert(r3.f.text and r3.values.text == nil and r3.f.text.h == S.hashValue(nil) and r3.rev.t == 1700000000005, "removed field keeps a stamp")
-- a remote edit of another field merges with ours
local remote = S.edit(r, { type = "ghost" }, { clock = { t = 1700000000010 }, now = 0, device = "browser" })
local m = S.mergeRecord(r3, remote)
assert(m.values.type == "ghost" and m.values.text == nil, "both edits kept")
