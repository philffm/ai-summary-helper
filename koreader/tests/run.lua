-- Runs every test_*.lua in this folder with plain LuaJIT (no KOReader): `luajit koreader/tests/run.lua`
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/../aish.koplugin/?.lua;" .. here .. "/?.lua;" .. package.path
local failed, passed = 0, 0
local p = io.popen('ls "' .. here .. '"/test_*.lua')
for file in p:lines() do
    local ok, err = pcall(dofile, file)
    if ok then passed = passed + 1; print("PASS " .. file:match("[^/]+$"))
    else failed = failed + 1; print("FAIL " .. file:match("[^/]+$") .. "\n  " .. tostring(err)) end
end
p:close()
print(string.format("%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
