--[[--
Nextcloud for the reader: its own login (Login Flow v2: a QR code you open on the phone), remote wipe, and giving the login
back when the reader is disconnected.

  Login Flow v2  POST <server>/index.php/login/v2 → { login = URL to open, poll = { token, endpoint } };
                 POST endpoint (token=…) → 404 until the person allowed it, then once { server, loginName, appPassword }.
  Remote wipe    after a 401/403: POST <server>/index.php/core/wipe/check (token=<app password>) → { wipe = true } means
                 "this device was removed in Nextcloud: delete everything"; then POST …/core/wipe/success.
  Revoke         DELETE <server>/ocs/v2.php/core/apppassword with the login (OCS-APIREQUEST: true).

https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html
https://docs.nextcloud.com/server/stable/developer_manual/client_apis/RemoteWipe/index.html

@module aishlib.nc
]]
local json = require("aishlib.json")
local ltn12 = require("ltn12")

local M = {}
M.USER_AGENT = "Kaivo KOReader"

local function form(t)
    local parts = {}
    for k, v in pairs(t) do
        parts[#parts + 1] = k .. "=" .. tostring(v):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end)
    end
    table.sort(parts)
    return table.concat(parts, "&")
end

--- The server's base address from a WebDAV address (…/remote.php/dav/files/<user>/ or …/remote.php/webdav/).
function M.serverOf(url)
    url = tostring(url or "")
    return url:match("^(https?://.-)/remote%.php") or url:match("^(https?://[^/]+)")
end

--- "cloud.example.com" or "https://cloud.example.com/" → "https://cloud.example.com"
function M.normalizeServer(s)
    s = tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""):gsub("/+$", "")
    if s == "" then return nil end
    if not s:match("^https?://") then s = "https://" .. s end
    return s:gsub("/index%.php$", "")
end

function M.new(http)
    http = http or require("socket.http")
    local self = {}
    local function request(method, url, body, headers, auth)
        local sink = {}
        headers = headers or {}
        headers["User-Agent"] = M.USER_AGENT
        if body then
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Content-Length"] = tostring(#body)
        end
        local ok, one, code = pcall(http.request, {
            url = url, method = method, headers = headers, sink = ltn12.sink.table(sink),
            source = body and ltn12.source.string(body) or nil,
            user = auth and auth.user, password = auth and auth.password,
        })
        if not ok then return nil, tostring(one) end
        if one == nil or type(code) ~= "number" then return nil, "The server could not be reached: " .. tostring(code) end
        return code, table.concat(sink)
    end

    --- → { login, token, endpoint } or nil, reason
    function self.startLogin(server)
        local code, text = request("POST", server .. "/index.php/login/v2", "")
        if code ~= 200 then return nil, code and ("Nextcloud answered " .. code .. ". Is this the address of your Nextcloud?") or text end
        local r = json.decode(text)
        if type(r) ~= "table" or type(r.login) ~= "string" or type(r.poll) ~= "table" or type(r.poll.token) ~= "string" then
            return nil, "This server does not offer the Nextcloud login."
        end
        return { login = r.login, token = r.poll.token, endpoint = r.poll.endpoint }
    end

    --- → { server, loginName, appPassword } once allowed, false while waiting, or nil, reason
    function self.poll(endpoint, token)
        local code, text = request("POST", endpoint, form({ token = token }))
        if code == 404 then return false end
        if code ~= 200 then return nil, code and ("Nextcloud answered " .. code) or text end
        local r = json.decode(text)
        if type(r) ~= "table" or type(r.appPassword) ~= "string" or type(r.loginName) ~= "string" then return nil, "Unexpected answer from Nextcloud." end
        return { server = json.val(r.server), loginName = r.loginName, appPassword = r.appPassword }
    end

    --- After the server refused the login: was this reader removed with "Wipe device"? → true / false (nil when unknown)
    function self.wipeRequested(server, appPassword)
        local code, text = request("POST", server .. "/index.php/core/wipe/check", form({ token = appPassword }))
        if code ~= 200 then return false end
        local r = json.decode(text)
        return type(r) == "table" and r.wipe == true
    end
    function self.wipeDone(server, appPassword)
        return request("POST", server .. "/index.php/core/wipe/success", form({ token = appPassword }))
    end

    --- Gives the reader's login back (best effort: it is gone from the reader either way).
    function self.revoke(server, user, appPassword)
        local code = request("DELETE", server .. "/ocs/v2.php/core/apppassword", nil, { ["OCS-APIREQUEST"] = "true" }, { user = user, password = appPassword })
        return code == 200
    end
    return self
end

return M
