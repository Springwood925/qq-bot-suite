// Allow time for travel, while bounding a failed route below the MCP timeout.
export function navigationTimeout(from,to) {
  if (!from || !to || ![from.x,from.y,from.z,to.x,to.y,to.z].every(Number.isFinite)) return 12000;
  const distance=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
  return Math.max(12000,Math.min(50000,Math.ceil(8000+distance*500)));
}

// A timeout after meaningful progress is not evidence of being stuck.
export function followNeedsUnstick(moved,distance) {
  return Number.isFinite(moved) && Number.isFinite(distance) && moved<0.4 && distance>4;
}
