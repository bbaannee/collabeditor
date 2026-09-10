const PALETTE = [
  '#e57373',
  '#f06292',
  '#ba68c8',
  '#7986cb',
  '#4fc3f7',
  '#4db6ac',
  '#81c784',
  '#ffb74d',
  '#ff8a65',
  '#a1887f',
];

// A stable color per user id, so the same person always shows up as the
// same color across sessions instead of a random one each time they connect.
export function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
