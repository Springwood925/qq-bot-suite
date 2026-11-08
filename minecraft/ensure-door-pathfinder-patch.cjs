// Reapply the 1.12 open-door path-point fix after mineflayer-pathfinder is installed.
const fs=require('node:fs');
const path=require('node:path');
const original='  function getPositionOnTopOf (block) {\n    if (!block || block.shapes.length === 0) return null\n';
const marker='// A 1.12 open door\'s thin vertical panel is not a floor.';
const fix=`  function getPositionOnTopOf (block) {
    if (!block || block.shapes.length === 0) return null
    // A 1.12 open door's thin vertical panel is not a floor.  Its real
    // collision shape is still used by physics; only path-point placement
    // should fall through to the support block underneath.
    if (/^1\\.12(?:\\.|$)/.test(String(bot.version || '')) && /^(?:wooden|spruce|birch|jungle|acacia|dark_oak)_door$/.test(String(block.name || '')) && Number.isInteger(block.metadata)) {
      const lower = (block.metadata & 8) ? bot.blockAt(block.position.offset(0, -1, 0), false) : block
      if (lower && lower.name === block.name && Number.isInteger(lower.metadata) && !(lower.metadata & 8) && (lower.metadata & 4)) return null
    }
`;
function patch(source){if(source.includes(marker))return source;const nl=source.includes('\r\n')?'\r\n':'\n',old=original.replace(/\n/g,nl),replacement=fix.replace(/\n/g,nl);const first=source.indexOf(old);if(first<0||source.indexOf(old,first+1)>=0)throw Error('mineflayer-pathfinder 版本与木门修复不匹配，请检查后再更新');return source.replace(old,replacement)}
if(require.main===module){const target=path.join(__dirname,'node_modules','mineflayer-pathfinder','index.js');const before=fs.readFileSync(target,'utf8'),after=patch(before);if(after!==before)fs.writeFileSync(target,after,'utf8');console.log('Minecraft 木门寻路兼容补丁已检查');}
module.exports={patch};
