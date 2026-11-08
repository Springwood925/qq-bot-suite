// Minecraft Java player inventory slots 5-8 are armour, outside inventory.items().
export function equipmentView(bot) {
 const slots=bot?.inventory?.slots;
 if(!Array.isArray(slots)||slots.length<9)return {available:false};
 const item=index=>{const i=slots[index];return i?{name:i.name,id:i.type,metadata:i.metadata??0,count:i.count,slot:index}:null};
 return {available:true,head:item(5),torso:item(6),legs:item(7),feet:item(8)};
}
