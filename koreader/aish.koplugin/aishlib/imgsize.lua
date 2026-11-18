--[[--
Width and height of an image from its first bytes (PNG, JPEG, GIF, WebP), without decoding it. Used to pick a cover
image: icons, favicons and tracking pixels are small, a photo or chart is not.

@module aishlib.imgsize
]]
local M = {}

local function be16(s, i) return s:byte(i) * 256 + s:byte(i + 1) end
local function be32(s, i) return ((s:byte(i) * 256 + s:byte(i + 1)) * 256 + s:byte(i + 2)) * 256 + s:byte(i + 3) end
local function le16(s, i) return s:byte(i) + s:byte(i + 1) * 256 end
local function le24(s, i) return s:byte(i) + s:byte(i + 1) * 256 + s:byte(i + 2) * 65536 end

--- → width, height, kind ("png" | "jpeg" | "gif" | "webp"), or nil
function M.size(b)
    if type(b) ~= "string" or #b < 24 then return nil end
    if b:sub(1, 8) == "\137PNG\r\n\26\n" then return be32(b, 17), be32(b, 21), "png" end
    if b:sub(1, 3) == "GIF" then return le16(b, 7), le16(b, 9), "gif" end
    if b:sub(1, 4) == "RIFF" and b:sub(9, 12) == "WEBP" then
        local chunk = b:sub(13, 16)
        if chunk == "VP8 " and #b >= 30 then return le16(b, 27) % 16384, le16(b, 29) % 16384, "webp" end
        if chunk == "VP8L" and #b >= 25 then
            local b1, b2, b3, b4 = b:byte(22, 25)
            return 1 + b1 + (b2 % 64) * 256, 1 + math.floor(b2 / 64) + b3 * 4 + (b4 % 16) * 1024, "webp"
        end
        if chunk == "VP8X" and #b >= 30 then return 1 + le24(b, 25), 1 + le24(b, 28), "webp" end
        return nil
    end
    if b:byte(1) == 0xFF and b:byte(2) == 0xD8 then   -- JPEG: walk the segments to a start-of-frame
        local i = 3
        while i + 9 <= #b do
            if b:byte(i) ~= 0xFF then i = i + 1
            else
                local marker = b:byte(i + 1)
                if marker == 0xD8 or marker == 0x01 or (marker >= 0xD0 and marker <= 0xD7) then i = i + 2
                elseif marker >= 0xC0 and marker <= 0xCF and marker ~= 0xC4 and marker ~= 0xC8 and marker ~= 0xCC then
                    return be16(b, i + 7), be16(b, i + 5), "jpeg"
                else i = i + 2 + be16(b, i + 2) end
            end
        end
    end
    return nil
end

local JUNK = { "logo", "icon", "avatar", "favicon", "emoji", "badge", "sprite", "pixel", "button", "banner%-ad", "advert", "spinner", "loading" }

--[[--
The image fit for a cover, or nil: at least 240×160 pixels and 6 KB, not extremely wide or tall, no logo/icon/avatar by
its description; among those the largest. images = { { data, alt } }
]]
function M.pickCover(images)
    local best, bestArea
    for i, im in ipairs(images or {}) do
        local w, h = M.size(im.data)
        local alt = tostring(im.alt or ""):lower()
        local junk = false
        for _, j in ipairs(JUNK) do if alt:find(j) then junk = true end end
        if w and h and not junk and w >= 240 and h >= 160 and #im.data >= 6 * 1024 then
            local ratio = w / h
            if ratio >= 0.4 and ratio <= 3.5 and (not bestArea or w * h > bestArea) then best, bestArea = i, w * h end
        end
    end
    return best
end

return M
