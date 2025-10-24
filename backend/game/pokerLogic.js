// Minimal placeholder poker logic to allow the server to start.
// These implementations are intentionally simple — replace with full game logic if needed.

export function evaluateHand(cards) {
  // cards: array of card objects {rank, suit, code}
  // Return simple ranking: high card by rank index
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  let best = -1;
  for (const c of cards) {
    const idx = ranks.indexOf(String(c.rank));
    if (idx > best) best = idx;
  }
  return { rankValue: best };
}

export function determineWinner(players) {
  // players: array of {id, hand}
  // Very naive: pick the player with highest evaluateHand().rankValue
  let best = null;
  for (const p of players) {
    const score = evaluateHand(p.hand || []);
    if (!best || score.rankValue > best.score.rankValue) {
      best = { player: p, score };
    }
  }
  return best ? best.player : null;
}
