--[[--
The reader's secrets (the Nextcloud login and the library key) sealed with a PIN.

    key = PBKDF2-SHA256(PIN, random salt, 600,000 rounds)    sealed = AES-256-GCM(key, JSON of the secrets)

What it does: someone who copies KOReader's settings off a lost reader does not get a working login or key without the
PIN. What it does not do: a short PIN can be guessed offline with enough computing power, and the articles already on
the reader (HTML files, KOReader's own data) stay readable, because KOReader opens them as plain files.

@module aishlib.vault
]]
local crypto = require("aishlib.crypto")
local json = require("aishlib.json")

local M = {}
M.ROUNDS = 600000

--- PIN + salt → the key (a few seconds on an e-reader).
function M.key(pin, salt, rounds)
    return crypto.pbkdf2(tostring(pin), salt, rounds or M.ROUNDS)
end

local function b64(s)
    local ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    return ((s:gsub(".", function(x)
        local r, b = "", x:byte()
        for i = 8, 1, -1 do r = r .. (b % 2 ^ i - b % 2 ^ (i - 1) > 0 and "1" or "0") end
        return r
    end) .. "0000"):gsub("%d%d%d?%d?%d?%d?", function(x)
        if #x < 6 then return "" end
        local c = 0
        for i = 1, 6 do c = c + (x:sub(i, i) == "1" and 2 ^ (6 - i) or 0) end
        return ALPHA:sub(c + 1, c + 1)
    end) .. ({ "", "==", "=" })[#s % 3 + 1])
end
M.b64 = b64

--- A new seal: → sealed table (for the settings), key (kept in memory while the reader is unlocked)
function M.create(secrets, pin, rounds)
    local salt = crypto.randomBytes(16)
    local key = M.key(pin, salt, rounds)
    return M.seal(secrets, key, salt, rounds), key
end

--- Seals again with a key already unlocked (when a secret changes).
function M.seal(secrets, key, salt, rounds)
    local nonce = crypto.randomBytes(12)
    return { v = 1, salt = b64(salt), rounds = rounds or M.ROUNDS, nonce = b64(nonce), data = b64(crypto.aesGcmEncrypt(key, nonce, json.encode(secrets))) }
end

--- sealed + PIN → secrets, key; nil when the PIN is wrong.
function M.open(sealed, pin)
    if type(sealed) ~= "table" or not sealed.salt or not sealed.data then return nil end
    local key = M.key(pin, crypto.fromB64(sealed.salt), tonumber(sealed.rounds) or M.ROUNDS)
    return M.openWithKey(sealed, key), key
end
function M.openWithKey(sealed, key)
    local text = crypto.aesGcmDecrypt(key, crypto.fromB64(sealed.nonce), crypto.fromB64(sealed.data))
    return text and json.decode(text) or nil
end
function M.saltOf(sealed) return crypto.fromB64(sealed.salt) end

return M
