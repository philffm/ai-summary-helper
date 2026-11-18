--[[--
A small ZIP writer (for EPUB files): stored or deflated entries, CRC-32 and raw deflate from zlib through LuaJIT FFI.
EPUB needs its first entry "mimetype" stored uncompressed; every other entry is deflated.

@module aishlib.zip
]]
local ffi = require("ffi")
local bit = require("bit")
require("aishlib.crypto")   -- declares the zlib functions and the stream type

for _, decl in ipairs({
    "unsigned long crc32(unsigned long, const unsigned char *, unsigned int);",
}) do pcall(ffi.cdef, decl) end

local function loadLib(name, version)
    if ffi.loadlib then
        local ok, lib = pcall(ffi.loadlib, name, version)
        if ok and lib then return lib end
    end
    return ffi.load(name)
end
local libz = loadLib("z", "1")

local M = {}

local function u16(n) return string.char(n % 256, math.floor(n / 256) % 256) end
local function u32(n) return string.char(n % 256, math.floor(n / 256) % 256, math.floor(n / 65536) % 256, math.floor(n / 16777216) % 256) end

function M.crc32(data)
    return tonumber(libz.crc32(0, data, #data))
end

--- Raw deflate (no zlib or gzip wrapper), as ZIP stores it.
function M.deflate(data)
    local strm = ffi.new("aish_z_stream")
    local input = ffi.new("unsigned char[?]", math.max(1, #data)); ffi.copy(input, data, #data)
    strm.next_in, strm.avail_in = input, #data
    assert(libz.deflateInit2_(strm, 6, 8, -15, 8, 0, libz.zlibVersion(), ffi.sizeof(strm)) == 0, "deflateInit failed")
    local chunk = 65536
    local buf = ffi.new("unsigned char[?]", chunk)
    local parts = {}
    while true do
        strm.next_out, strm.avail_out = buf, chunk
        local rc = libz.deflate(strm, 4)
        local got = chunk - strm.avail_out
        if got > 0 then parts[#parts + 1] = ffi.string(buf, got) end
        if rc == 1 then break end
        if rc ~= 0 and rc ~= -5 then libz.deflateEnd(strm); error("compression failed") end
    end
    libz.deflateEnd(strm)
    return table.concat(parts)
end

--- entries = { { name, data, store = true? } } → the bytes of a ZIP file. `time` (seconds) is the entries' date.
function M.build(entries, time)
    local t = os.date("*t", time or os.time())
    local dosTime = bit.bor(bit.lshift(t.hour, 11), bit.lshift(t.min, 5), math.floor(t.sec / 2))
    local dosDate = bit.bor(bit.lshift(math.max(0, t.year - 1980), 9), bit.lshift(t.month, 5), t.day)
    local out, central, offset = {}, {}, 0
    for _, e in ipairs(entries) do
        local data = e.data
        local crc = M.crc32(data)
        local method, body = 0, data
        if not e.store then
            local d = M.deflate(data)
            if #d < #data then method, body = 8, d end
        end
        local name = e.name
        local header = "PK\3\4" .. u16(20) .. u16(0x0800) .. u16(method) .. u16(dosTime) .. u16(dosDate)
            .. u32(crc) .. u32(#body) .. u32(#data) .. u16(#name) .. u16(0) .. name
        out[#out + 1] = header; out[#out + 1] = body
        central[#central + 1] = "PK\1\2" .. u16(20) .. u16(20) .. u16(0x0800) .. u16(method) .. u16(dosTime) .. u16(dosDate)
            .. u32(crc) .. u32(#body) .. u32(#data) .. u16(#name) .. u16(0) .. u16(0) .. u16(0) .. u16(0) .. u32(0) .. u32(offset) .. name
        offset = offset + #header + #body
    end
    local cd = table.concat(central)
    out[#out + 1] = cd
    out[#out + 1] = "PK\5\6" .. u16(0) .. u16(0) .. u16(#entries) .. u16(#entries) .. u32(#cd) .. u32(offset) .. u16(0)
    return table.concat(out)
end

return M
