--[[--
Keys and decryption for encrypted AISH sync places, the same scheme as the extension (plugin/src/modules/syncCrypto.js):

    passphrase --PBKDF2-SHA256(salt, iterations)--> 32-byte master key
    master --HKDF-SHA256(info)--> encKey (AES-256-GCM) and nameKey (HMAC-SHA256, for opaque file names)
    file = version byte (1) | 12-byte nonce | AES-GCM ciphertext (+16-byte tag) of gzip(JSON)

Everything runs in native code through LuaJIT FFI: KOReader ships LibreSSL's libcrypto and zlib, so the 600,000 key
derivation rounds take seconds, not hours. Outside KOReader (the tests) the system's libcrypto and libz are used.

@module aishlib.crypto
]]

local ffi = require("ffi")
local bit = require("bit")

-- Each declaration on its own: KOReader's ffi/crypto_h may already have declared some of them, and a second identical
-- declaration of a type is an error in LuaJIT.
for _, decl in ipairs({
    "typedef struct engine_st ENGINE;",
    "typedef struct evp_cipher_st EVP_CIPHER;",
    "typedef struct evp_cipher_ctx_st EVP_CIPHER_CTX;",
    "typedef struct evp_md_st EVP_MD;",
    "const EVP_MD *EVP_sha256(void);",
    "const EVP_CIPHER *EVP_aes_256_gcm(void);",
    "EVP_CIPHER_CTX *EVP_CIPHER_CTX_new(void);",
    "void EVP_CIPHER_CTX_free(EVP_CIPHER_CTX *);",
    "int EVP_CIPHER_CTX_ctrl(EVP_CIPHER_CTX *, int, int, void *);",
    "int EVP_DecryptInit_ex(EVP_CIPHER_CTX *, const EVP_CIPHER *, ENGINE *, const unsigned char *, const unsigned char *);",
    "int EVP_DecryptUpdate(EVP_CIPHER_CTX *, unsigned char *, int *, const unsigned char *, int);",
    "int EVP_DecryptFinal_ex(EVP_CIPHER_CTX *, unsigned char *, int *);",
    "int EVP_EncryptInit_ex(EVP_CIPHER_CTX *, const EVP_CIPHER *, ENGINE *, const unsigned char *, const unsigned char *);",
    "int EVP_EncryptUpdate(EVP_CIPHER_CTX *, unsigned char *, int *, const unsigned char *, int);",
    "int EVP_EncryptFinal_ex(EVP_CIPHER_CTX *, unsigned char *, int *);",
    "int RAND_bytes(unsigned char *, int);",
    "int EVP_DecodeBlock(unsigned char *, const unsigned char *, int);",
    "int PKCS5_PBKDF2_HMAC(const char *, int, const unsigned char *, int, int, const EVP_MD *, int, unsigned char *);",
    "unsigned char *HMAC(const EVP_MD *, const void *, int, const unsigned char *, size_t, unsigned char *, unsigned int *);",
    [[typedef struct aish_z_stream_s {
        const unsigned char *next_in; unsigned int avail_in; unsigned long total_in;
        unsigned char *next_out; unsigned int avail_out; unsigned long total_out;
        const char *msg; void *state; void *zalloc; void *zfree; void *opaque;
        int data_type; unsigned long adler; unsigned long reserved;
    } aish_z_stream;]],
    "const char *zlibVersion(void);",
    "int inflateInit2_(aish_z_stream *, int, const char *, int);",
    "int inflate(aish_z_stream *, int);",
    "int inflateEnd(aish_z_stream *);",
    "int deflateInit2_(aish_z_stream *, int, int, int, int, int, const char *, int);",
    "int deflate(aish_z_stream *, int);",
    "int deflateEnd(aish_z_stream *);",
}) do pcall(ffi.cdef, decl) end

local function loadLib(name, version)
    if ffi.loadlib then   -- KOReader (ffi/loadlib): its bundled build, or the monolithic library on newer builds
        local ok, lib = pcall(ffi.loadlib, name, version)
        if ok and lib then return lib end
    end
    return ffi.load(name)
end
local libcrypto = loadLib("crypto", "57")
local libz = loadLib("z", "1")

local M = {}
M.FILE_VERSION = 1
M.KDF_ITERATIONS = 600000
local CHECK_TEXT = "aish-sync-ok"

-- ── encodings ───────────────────────────────────────────────────────────────
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64DEC = {}
for i = 1, 64 do B64DEC[B64:byte(i)] = i - 1 end

function M.fromB64(s)
    s = tostring(s or ""):gsub("[^%w%+/=]", "")
    local out, n, bits, acc = {}, 0, 0, 0
    for i = 1, #s do
        local v = B64DEC[s:byte(i)]
        if v then
            acc = bit.bor(bit.lshift(acc, 6), v); bits = bits + 6
            if bits >= 8 then
                bits = bits - 8
                n = n + 1; out[n] = string.char(bit.band(bit.rshift(acc, bits), 0xff))
            end
        end
    end
    return table.concat(out)
end

--- Large base64 (images) in native code; the padding bytes EVP_DecodeBlock leaves are cut off.
function M.fromB64Fast(s)
    s = tostring(s or ""):gsub("[^A-Za-z0-9+/=]", "")
    if #s % 4 ~= 0 then s = s .. string.rep("=", 4 - #s % 4) end
    local out = ffi.new("unsigned char[?]", #s / 4 * 3 + 1)
    local n = libcrypto.EVP_DecodeBlock(out, s, #s)
    if n < 0 then return nil end
    local pad = #s:match("=*$")
    return ffi.string(out, n - pad)
end

function M.toHex(s) return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end)) end
function M.fromHex(h) return (tostring(h or ""):gsub("%x%x", function(x) return string.char(tonumber(x, 16)) end)) end

-- ── primitives ──────────────────────────────────────────────────────────────
function M.pbkdf2(passphrase, salt, iterations)
    local out = ffi.new("unsigned char[32]")
    local ok = libcrypto.PKCS5_PBKDF2_HMAC(passphrase, #passphrase, salt, #salt, iterations, libcrypto.EVP_sha256(), 32, out)
    assert(ok == 1, "PBKDF2 failed")
    return ffi.string(out, 32)
end

function M.hmac(key, data)
    local out, len = ffi.new("unsigned char[32]"), ffi.new("unsigned int[1]")
    assert(libcrypto.HMAC(libcrypto.EVP_sha256(), key, #key, data, #data, out, len) ~= nil, "HMAC failed")
    return ffi.string(out, len[0])
end

--- HKDF-SHA256 (RFC 5869) with an empty salt, as Web Crypto's deriveKey does in the extension. 32 bytes out.
function M.hkdf(ikm, info)
    local prk = M.hmac(string.rep("\0", 32), ikm)
    return M.hmac(prk, info .. "\1")
end

--- AES-256-GCM: ciphertext with the 16-byte tag at its end (Web Crypto's layout). nil when the key or the data is wrong.
function M.aesGcmDecrypt(key, nonce, data)
    if #data < 16 then return nil end
    local ct, tag = data:sub(1, -17), data:sub(-16)
    local ctx = libcrypto.EVP_CIPHER_CTX_new()
    if ctx == nil then return nil end
    local out = ffi.new("unsigned char[?]", #ct + 16)
    local len, fin = ffi.new("int[1]"), ffi.new("int[1]")
    local tagbuf = ffi.new("unsigned char[16]"); ffi.copy(tagbuf, tag, 16)
    local ok = libcrypto.EVP_DecryptInit_ex(ctx, libcrypto.EVP_aes_256_gcm(), nil, nil, nil) == 1
        and libcrypto.EVP_CIPHER_CTX_ctrl(ctx, 0x9, #nonce, nil) == 1                     -- EVP_CTRL_GCM_SET_IVLEN
        and libcrypto.EVP_DecryptInit_ex(ctx, nil, nil, key, nonce) == 1
        and libcrypto.EVP_DecryptUpdate(ctx, out, len, ct, #ct) == 1
        and libcrypto.EVP_CIPHER_CTX_ctrl(ctx, 0x11, 16, tagbuf) == 1                     -- EVP_CTRL_GCM_SET_TAG
        and libcrypto.EVP_DecryptFinal_ex(ctx, out + len[0], fin) == 1
    libcrypto.EVP_CIPHER_CTX_free(ctx)
    if not ok then return nil end
    return ffi.string(out, len[0] + fin[0])
end

--- gzip → bytes. Refuses more than `max` bytes (default 64 MB), like the extension.
function M.gunzip(data, max)
    max = max or 64 * 1024 * 1024
    local strm = ffi.new("aish_z_stream")
    local input = ffi.new("unsigned char[?]", #data); ffi.copy(input, data, #data)
    strm.next_in, strm.avail_in = input, #data
    assert(libz.inflateInit2_(strm, 31, libz.zlibVersion(), ffi.sizeof(strm)) == 0, "inflateInit failed")   -- 31 = gzip wrapper
    local chunk = 65536
    local buf = ffi.new("unsigned char[?]", chunk)
    local parts, total = {}, 0
    while true do
        strm.next_out, strm.avail_out = buf, chunk
        local rc = libz.inflate(strm, 0)
        local got = chunk - strm.avail_out
        if got > 0 then
            total = total + got
            if total > max then libz.inflateEnd(strm); error("The file is larger than expected.") end
            parts[#parts + 1] = ffi.string(buf, got)
        end
        if rc == 1 then break end                                       -- Z_STREAM_END
        if rc ~= 0 or (got == 0 and strm.avail_in == 0) then libz.inflateEnd(strm); error("Damaged compressed data.") end
    end
    libz.inflateEnd(strm)
    return table.concat(parts)
end

--- bytes → gzip (what the extension's CompressionStream("gzip") reads).
function M.gzip(data)
    local strm = ffi.new("aish_z_stream")
    local input = ffi.new("unsigned char[?]", math.max(1, #data)); ffi.copy(input, data, #data)
    strm.next_in, strm.avail_in = input, #data
    assert(libz.deflateInit2_(strm, 6, 8, 31, 8, 0, libz.zlibVersion(), ffi.sizeof(strm)) == 0, "deflateInit failed")
    local chunk = 65536
    local buf = ffi.new("unsigned char[?]", chunk)
    local parts = {}
    while true do
        strm.next_out, strm.avail_out = buf, chunk
        local rc = libz.deflate(strm, 4)                                -- Z_FINISH
        local got = chunk - strm.avail_out
        if got > 0 then parts[#parts + 1] = ffi.string(buf, got) end
        if rc == 1 then break end                                        -- Z_STREAM_END
        if rc ~= 0 and rc ~= -5 then libz.deflateEnd(strm); error("compression failed") end
    end
    libz.deflateEnd(strm)
    return table.concat(parts)
end

--- n random bytes from the system's generator (libcrypto).
function M.randomBytes(n)
    local buf = ffi.new("unsigned char[?]", n)
    assert(libcrypto.RAND_bytes(buf, n) == 1, "no random numbers")
    return ffi.string(buf, n)
end

--- AES-256-GCM: ciphertext with the 16-byte tag at its end.
function M.aesGcmEncrypt(key, nonce, plain)
    local ctx = libcrypto.EVP_CIPHER_CTX_new()
    assert(ctx ~= nil, "no cipher")
    local out = ffi.new("unsigned char[?]", #plain + 32)
    local len, fin = ffi.new("int[1]"), ffi.new("int[1]")
    local tag = ffi.new("unsigned char[16]")
    local ok = libcrypto.EVP_EncryptInit_ex(ctx, libcrypto.EVP_aes_256_gcm(), nil, nil, nil) == 1
        and libcrypto.EVP_CIPHER_CTX_ctrl(ctx, 0x9, #nonce, nil) == 1
        and libcrypto.EVP_EncryptInit_ex(ctx, nil, nil, key, nonce) == 1
        and libcrypto.EVP_EncryptUpdate(ctx, out, len, plain, #plain) == 1
        and libcrypto.EVP_EncryptFinal_ex(ctx, out + len[0], fin) == 1
        and libcrypto.EVP_CIPHER_CTX_ctrl(ctx, 0x10, 16, tag) == 1                       -- EVP_CTRL_GCM_GET_TAG
    libcrypto.EVP_CIPHER_CTX_free(ctx)
    assert(ok, "encryption failed")
    return ffi.string(out, len[0] + fin[0]) .. ffi.string(tag, 16)
end

--- JSON text → the bytes of a sync file (version | nonce | AES-GCM(gzip(text))), like encryptJson in the extension.
function M.encryptFile(keys, text, nonce)
    nonce = nonce or M.randomBytes(12)
    return string.char(M.FILE_VERSION) .. nonce .. M.aesGcmEncrypt(keys.enc, nonce, M.gzip(text))
end

-- ── the scheme ──────────────────────────────────────────────────────────────
function M.deriveMaster(passphrase, salt, iterations)
    return M.pbkdf2(tostring(passphrase), salt, iterations or M.KDF_ITERATIONS)
end

--- { enc = 32 bytes, name = 32 bytes } from the master key.
function M.subKeys(master)
    return { enc = M.hkdf(master, "aish-sync-enc-v1"), name = M.hkdf(master, "aish-sync-name-v1") }
end

--- Encrypted file bytes → the JSON text inside. nil, reason on a wrong key, a damaged file or an unknown version.
function M.decryptFile(keys, bytes)
    if type(bytes) ~= "string" or #bytes < 30 or bytes:byte(1) ~= M.FILE_VERSION then
        return nil, "This file is not a sync file this version understands."
    end
    local plain = M.aesGcmDecrypt(keys.enc, bytes:sub(2, 13), bytes:sub(14))
    if not plain then return nil, "The file could not be decrypted: wrong passphrase or damaged file." end
    local ok, text = pcall(M.gunzip, plain)
    if not ok then return nil, tostring(text) end
    return text
end

--- Opaque file name of a record: hex of HMAC(nameKey, "type:id").
function M.nameOf(keys, typ, id)
    return M.toHex(M.hmac(keys.name, typ .. ":" .. id))
end

--- meta.json (decoded table) + passphrase → keys, master. nil, reason when it is not an encrypted place or the passphrase is wrong.
function M.openMeta(meta, passphrase)
    if type(meta) ~= "table" or meta.mode ~= "encrypted" or not meta.check or not meta.salt then
        return nil, "This is not an encrypted AISH sync place."
    end
    if meta.kdf and meta.kdf ~= "pbkdf2-sha256" then return nil, "This place uses a key derivation this plugin does not know." end
    local master = M.deriveMaster(passphrase, M.fromB64(meta.salt), tonumber(meta.iterations) or M.KDF_ITERATIONS)
    return M.openWithMaster(meta, master)
end

--- With a master key kept on this device: checks the key-check blob first.
function M.openWithMaster(meta, master)
    local keys = M.subKeys(master)
    local text = M.decryptFile(keys, M.fromB64(meta.check))
    if text ~= '"' .. CHECK_TEXT .. '"' then return nil, "Wrong passphrase: it does not open this place." end
    return keys, master
end

return M
