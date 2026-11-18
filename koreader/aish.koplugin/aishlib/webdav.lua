--[[--
A read-only WebDAV client for a sync place (Nextcloud, ownCloud, most NAS boxes): list one folder, read one file.
Paths are relative to the place's folder, like the extension's store (plugin/src/modules/syncWebdav.js).

@module aishlib.webdav
]]
local ltn12 = require("ltn12")

local M = {}

local function encSeg(s)
    return (s:gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end
local function segs(p)
    local out = {}
    for s in tostring(p or ""):gmatch("[^/]+") do out[#out + 1] = s end
    return out
end
local function urlDecode(s) return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)) end
local function unxml(s)
    return (s:gsub("&quot;", '"'):gsub("&apos;", "'"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&amp;", "&"))
end

--- The `<d:response>` entries of a PROPFIND answer: { href, etag, size, isDir }.
function M.parseMultistatus(xml)
    local out = {}
    for block in tostring(xml or ""):gmatch("<[%w%-]*:?response[%s>].-</[%w%-]*:?response>") do
        local function pick(tag)
            return block:match("<[%w%-]*:?" .. tag .. "[^>]*>(.-)</[%w%-]*:?" .. tag .. ">") or ""
        end
        local etag = unxml(pick("getetag")):gsub("^W/", ""):gsub('^"', ""):gsub('"$', "")
        out[#out + 1] = {
            href = urlDecode(unxml(pick("href"))),
            etag = etag,
            size = tonumber(pick("getcontentlength")) or 0,
            modified = pick("getlastmodified"),
            isDir = block:find("<[%w%-]*:?collection[%s/>]") ~= nil,
        }
    end
    return out
end

--[[--
cfg = { url, root, username, password, http = socket.http-like module, timeout = fn(kind)/nil }
`url` is the account's WebDAV address (Nextcloud: https://host/remote.php/dav/files/<user>/), `root` the folder in it.
]]
function M.new(cfg)
    local self = {}
    local http = cfg.http or require("socket.http")
    local base = tostring(cfg.url or ""):gsub("/+$", "") .. "/"
    local root = segs(cfg.root or "aish-sync")
    local function urlOf(path, dir)
        local parts = {}
        for _, s in ipairs(root) do parts[#parts + 1] = encSeg(s) end
        for _, s in ipairs(segs(path)) do parts[#parts + 1] = encSeg(s) end
        return base .. table.concat(parts, "/") .. (dir and "/" or "")
    end

    local function request(method, url, body, headers, maxBytes)
        local sink, size = {}, 0
        local limited = function(chunk, err)
            if chunk then
                size = size + #chunk
                if maxBytes and size > maxBytes then return nil, "too large" end
                sink[#sink + 1] = chunk
            end
            return 1
        end
        headers = headers or {}
        if body then headers["Content-Length"] = tostring(#body) end
        if cfg.beforeRequest then cfg.beforeRequest(method) end
        -- a table request answers (1, code, headers, status) or (nil, error)
        local ok, one, code, resHeaders, status = pcall(http.request, {
            url = url, method = method, headers = headers,
            user = cfg.username ~= "" and cfg.username or nil, password = cfg.password ~= "" and cfg.password or nil,
            source = body and ltn12.source.string(body) or nil,
            sink = limited, redirect = false,
        })
        if cfg.afterRequest then cfg.afterRequest(method) end
        if not ok then return nil, tostring(one) end
        if one == nil or type(code) ~= "number" then return nil, "The server could not be reached: " .. tostring(status or code or "no response") end
        return code, table.concat(sink), resHeaders
    end

    local function failure(code, text)
        if code == 401 or code == 403 then return "The server refused the login (" .. code .. "). Check user and app password." end
        if code == 404 then return "The folder was not found on the server (404). Check the address and the folder." end
        return "The server answered " .. tostring(code) .. (text and (": " .. tostring(text):sub(1, 120)) or "")
    end

    --- Files directly in `prefix` → { { name, etag, size } }, or nil, reason.
    function self.list(prefix)
        local url = urlOf(prefix, true)
        local body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>'
        local code, text = request("PROPFIND", url, body, { Depth = "1", ["Content-Type"] = "application/xml" })
        if code == 404 then return {} end
        if code ~= 207 and code ~= 200 then return nil, code and failure(code, text) or text end
        local out = {}
        for _, e in ipairs(M.parseMultistatus(text)) do
            local name = e.href:gsub("/+$", ""):match("([^/]+)$")
            if not e.isDir and name then
                -- servers without an ETag still change size or date when a file changes
                out[#out + 1] = { name = name, etag = e.etag ~= "" and e.etag or (e.size .. "@" .. e.modified), size = e.size }
            end
        end
        return out
    end

    --- A file's bytes, false when it does not exist, or nil, reason.
    function self.get(path, maxBytes)
        local code, text = request("GET", urlOf(path), nil, nil, maxBytes or 20 * 1024 * 1024)
        if code == 200 then return text end
        if code == 404 then return false end
        return nil, code and failure(code) or text
    end

    return self
end

return M
