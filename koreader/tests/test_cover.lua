-- Covers: image sizes from headers, the choice of a cover image (no icons, logos or tiny images), and the EPUB with a
-- made cover (a stand-in for KOReader's drawing) or none (then KOReader draws its own title cover).
local I, E = require("aishlib.imgsize"), require("aishlib.epub")
local function be32(n) return string.char(math.floor(n / 16777216) % 256, math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256) end
local function png(w, h, pad) return "\137PNG\r\n\26\n" .. be32(13) .. "IHDR" .. be32(w) .. be32(h) .. "\8\2\0\0\0" .. string.rep("x", pad or 0) end
local function jpeg(w, h, pad)
    return "\255\216" .. "\255\224\0\16JFIF\0\1\1\0\0\1\0\1\0\0" .. "\255\192\0\17\8" .. string.char(math.floor(h / 256), h % 256, math.floor(w / 256), w % 256) .. "\3\1\34\0" .. string.rep("x", pad or 0)
end
local function gif(w, h) return "GIF89a" .. string.char(w % 256, math.floor(w / 256), h % 256, math.floor(h / 256)) .. string.rep("\0", 20) end
assert(select(1, I.size(png(800, 450))) == 800 and select(2, I.size(png(800, 450))) == 450)
local w, h, k = I.size(jpeg(1200, 675)); assert(w == 1200 and h == 675 and k == "jpeg", tostring(w) .. "x" .. tostring(h))
w, h = I.size(gif(16, 16)); assert(w == 16 and h == 16)

local big = 8 * 1024
assert(I.pickCover({ { data = png(16, 16, big) }, { data = gif(32, 32) } }) == nil, "only icons: no cover image")
assert(I.pickCover({ { data = png(32, 32, big) }, { data = jpeg(1200, 675, big) }, { data = png(800, 600, big) } }) == 2, "the largest photo")
assert(I.pickCover({ { data = jpeg(1200, 675, big), alt = "Company Logo" }, { data = png(640, 400, big) } }) == 2, "a logo is not a cover")
assert(I.pickCover({ { data = png(3000, 300, big) } }) == nil, "a banner strip is not a cover")
assert(I.pickCover({ { data = png(800, 600, 100) } }) == nil, "too few bytes to be a real picture")

-- the EPUB: a made cover always (with or without an image); no renderer → no cover at all (not the first image)
local b64 = require("aishlib.vault").b64
local favicon = b64(png(16, 16, 64))
local photo = b64(jpeg(1200, 675, big))
local a = { title = "Why we sleep", url = "https://science.example/sleep", timestamp = "2026-11-02T08:00:00.000Z", summaryBase = "<p>Sleep consolidates memory.</p>",
    content = '<p><img src="data:image/png;base64,' .. favicon .. '" alt="site icon">Text</p><p><img src="data:image/jpeg;base64,' .. photo .. '" alt="A brain"></p>' }
local seen
local bytes = E.build(a, {}, {}, { id = "a1", cover = function(info) seen = info; return png(600, 800, 10) end })
assert(seen.title == "Why we sleep" and seen.site == "science.example" and seen.date == "2026-11-02" and seen.summary == "Sleep consolidates memory.")
assert(seen.image and I.size(seen.image) == 1200, "the photo, not the favicon")
local dir = os.tmpname(); os.remove(dir); os.execute("mkdir -p " .. dir)
local function opfOf(b) local f = io.open(dir .. "/t.epub", "wb"); f:write(b); f:close(); local p = io.popen("unzip -p " .. dir .. "/t.epub OEBPS/content.opf"); local t = p:read("*a"); p:close(); return t end
local opf = opfOf(bytes)
assert(opf:find('<item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>', 1, true) and select(2, opf:gsub("cover%-image", "")) == 1, "the made cover is the cover")
local only = E.build({ title = "No pictures", url = "https://x.example/", content = "<p>Text</p>" }, {}, {}, { id = "a2", cover = function(info) seen = info; return png(600, 800, 10) end })
assert(seen.image == nil and opfOf(only):find("cover-image", 1, true), "a cover without an image: title and summary")
assert(not opfOf(E.build(a, {}, {}, { id = "a3" })):find("cover-image", 1, true), "no renderer: no cover (KOReader draws its own), never the first image")
assert(not opfOf(E.build(a, {}, {}, { id = "a4", cover = function() error("no fonts") end })):find("cover-image", 1, true), "a failing renderer: no cover")
os.execute("rm -rf " .. dir)
