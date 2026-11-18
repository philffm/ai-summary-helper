-- The crypto must agree with the extension: plugin/tests/fixtures/sync-vector.json is made by the extension's own code.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$")
local C = require("aishlib.crypto")
local json = require("aishlib.json")
local f = assert(io.open(here .. "/../../plugin/tests/fixtures/sync-vector.json", "rb")); local vec = json.decode(f:read("*a")); f:close()
local c = vec.crypto

local master = C.deriveMaster(c.passphrase, C.fromHex(c.saltHex), c.iterations)
assert(C.toHex(master) == c.masterHex, "master key " .. C.toHex(master))
local keys = assert(C.openMeta(c.meta, c.passphrase))
assert(C.openMeta(c.meta, "wrong passphrase here") == nil, "wrong passphrase is refused")
for _, n in ipairs(c.names) do assert(C.nameOf(keys, n.type, n.id) == n.name, "name of " .. n.type .. ":" .. n.id) end
local text = assert(C.decryptFile(keys, C.fromB64(c.recordFile)))
local rec = json.decode(text)
assert(rec.key == c.record.key and rec.values.title == c.record.values.title and rec.rev.t == c.record.rev.t, "record decrypts: " .. text)
-- a flipped byte → refused, not garbage
local bad = C.fromB64(c.recordFile); bad = bad:sub(1, 40) .. string.char((bad:byte(41) + 1) % 256) .. bad:sub(42)
assert(C.decryptFile(keys, bad) == nil, "damaged file refused")
assert(C.decryptFile(keys, "\2" .. string.rep("x", 40)) == nil, "unknown version refused")
-- RFC 5869 test case 3 (empty salt and info): our HKDF is the standard one
local okm = C.hmac(C.hmac(string.rep("\0", 32), C.fromHex(string.rep("0b", 22))), "\1")
assert(C.toHex(okm):sub(1, 64) == "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d", "HKDF RFC 5869 #3")
-- encrypting: our file opens with our decrypt; nonces differ; the extension opens it too (test_interop_write checks that)
local text = '{"aish":"rec/1","key":"hl:x","rev":{"t":1,"d":"ko"},"f":{},"values":{"text":"Grüße ' .. string.rep("long text ", 5000) .. '"}}'
local a, b = C.encryptFile(keys, text), C.encryptFile(keys, text)
assert(a ~= b and a:byte(1) == 1 and #a < #text, "fresh nonce, compressed")
assert(C.decryptFile(keys, a) == text, "round trip")
assert(C.gunzip(C.gzip("")) == "", "empty")
