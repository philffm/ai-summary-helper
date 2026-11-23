-- The PIN seal and the Nextcloud login / wipe calls (with a stand-in for the HTTP library).
local V, N, C = require("aishlib.vault"), require("aishlib.nc"), require("aishlib.crypto")
local json = require("aishlib.json")

-- vault: round trip, wrong PIN, re-seal with the kept key, no secret in the clear
local secrets = { password = "app-pass-123", master = string.rep("ab", 32) }
local sealed, key = V.create(secrets, "4711", 1000)
assert(sealed.rounds == 1000 and not json.encode(sealed):find("app%-pass") and not json.encode(sealed):find(string.rep("ab", 32)), "nothing readable")
local got = V.open(sealed, "4711"); assert(got and got.password == "app-pass-123" and got.master == secrets.master)
assert(V.open(sealed, "4712") == nil, "wrong PIN")
local again = V.seal({ password = "new" }, key, V.saltOf(sealed), 1000)
assert(V.open(again, "4711").password == "new" and again.nonce ~= sealed.nonce, "re-sealed with the same PIN, fresh nonce")
assert(C.toHex(C.fromB64(V.b64("\0\1\2\255xyz"))) == C.toHex("\0\1\2\255xyz"), "base64 round trip")

-- nc: server address forms
assert(N.serverOf("https://cloud.example.com/nc/remote.php/dav/files/phil/") == "https://cloud.example.com/nc")
assert(N.normalizeServer(" cloud.example.com/ ") == "https://cloud.example.com" and N.normalizeServer("http://x.lan/index.php") == "http://x.lan")

-- nc: the calls, against canned answers
local calls, answers = {}, {}
local http = { request = function(req)
    local body = req.source and req.source() or nil
    calls[#calls + 1] = { method = req.method, url = req.url, body = body, ua = req.headers["User-Agent"], user = req.user, ocs = req.headers["OCS-APIREQUEST"] }
    local a = table.remove(answers, 1) or { 500, "" }
    req.sink(a[2]); req.sink(nil)
    return 1, a[1], {}, "status"
end }
local nc = N.new(http)
answers = { { 200, '{"poll":{"token":"T0","endpoint":"https://c.example/login/v2/poll"},"login":"https://c.example/login/v2/flow/abc"}' } }
local s = nc.startLogin("https://c.example")
assert(s.login == "https://c.example/login/v2/flow/abc" and s.token == "T0" and calls[1].url == "https://c.example/index.php/login/v2" and calls[1].ua == "Kaivo KOReader")
answers = { { 404, "" }, { 200, '{"server":"https://c.example","loginName":"phil-reader","appPassword":"AP"}' } }
assert(nc.poll(s.endpoint, s.token) == false, "waiting")
local r = nc.poll(s.endpoint, s.token)
assert(r.loginName == "phil-reader" and r.appPassword == "AP" and calls[#calls].body == "token=T0")
answers = { { 200, '{"wipe":true}' } }
assert(nc.wipeRequested("https://c.example", "AP") == true and calls[#calls].url == "https://c.example/index.php/core/wipe/check" and calls[#calls].body == "token=AP")
answers = { { 404, "" } }
assert(nc.wipeRequested("https://c.example", "AP") == false, "no wipe endpoint: no wipe")
answers = { { 200, "" } }
nc.wipeDone("https://c.example", "AP"); assert(calls[#calls].url:find("/core/wipe/success$"))
answers = { { 200, "" } }
assert(nc.revoke("https://c.example", "phil-reader", "AP") and calls[#calls].method == "DELETE" and calls[#calls].ocs == "true" and calls[#calls].user == "phil-reader")
