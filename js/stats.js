// Connect Four — pure aggregation of finished-game history for the Stats screen.
// No DOM, no storage: just data in, summary out (so it's unit-testable in Node,
// like engine.js / bot.js). The app persists the history via loadJSON/saveJSON.

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'insane'];
export const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane' };

export function emptyHistory() {
  return { games: [] };
}

// Append one finished round. `record` = { mode:'bot'|'2p', difficulty?, winner:1|2|'draw' }.
// In bot mode the human is Player 1 and the bot is Player 2.
export function recordGame(history, record) {
  const games = history && Array.isArray(history.games) ? history.games.slice() : [];
  games.push({
    mode: record.mode === 'bot' ? 'bot' : '2p',
    difficulty: record.mode === 'bot' ? record.difficulty || 'medium' : null,
    winner: record.winner, // 1 | 2 | 'draw'
    at: record.at || Date.now(),
  });
  return { games };
}

// Aggregate a history into the numbers the Stats screen shows.
export function summarize(history) {
  const games = history && Array.isArray(history.games) ? history.games : [];
  const s = {
    total: games.length,
    bot: { played: 0, won: 0, lost: 0, drawn: 0 },
    twoPlayer: { played: 0, p1: 0, p2: 0, drawn: 0 },
    perDifficulty: {},
    streakCurrent: 0, // trailing run of human wins vs the bot (2-player games ignored)
    streakBest: 0,
  };
  for (const d of DIFFICULTIES) s.perDifficulty[d] = { played: 0, won: 0 };

  let cur = 0;
  let best = 0;
  for (const g of games) {
    if (g.mode === 'bot') {
      s.bot.played++;
      const pd = s.perDifficulty[g.difficulty] || (s.perDifficulty[g.difficulty] = { played: 0, won: 0 });
      pd.played++;
      if (g.winner === 1) {
        s.bot.won++;
        pd.won++;
        cur++;
        if (cur > best) best = cur;
      } else if (g.winner === 2) {
        s.bot.lost++;
        cur = 0;
      } else {
        s.bot.drawn++;
        cur = 0; // a draw ends the win streak
      }
    } else {
      s.twoPlayer.played++;
      if (g.winner === 1) s.twoPlayer.p1++;
      else if (g.winner === 2) s.twoPlayer.p2++;
      else s.twoPlayer.drawn++;
    }
  }
  s.streakCurrent = cur;
  s.streakBest = best;
  return s;
}

// Win rate (0–100, integer) for a {played, won} bucket; 0 when nothing played.
export function winRate(bucket) {
  if (!bucket || !bucket.played) return 0;
  return Math.round((bucket.won / bucket.played) * 100);
}
