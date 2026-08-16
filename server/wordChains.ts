// Curated pool of puzzles for the Word Chain game.
//
// A chain is a run of words where every neighbouring pair makes a compound word
// or a set phrase — SUN·FLOWER, FLOWER·BED, BED·ROOM, and so on. Players see the
// two ends and race to fill everything between them, top down.
//
// Rules the bank follows, so guesses can be checked by exact match:
//
//   * Each link is a real closed compound (BACKPACK) or a standard two-word
//     phrase (PACK RAT). No inflection tricks — "LUCK → CHARM" via *lucky*
//     charm doesn't belong here, because a player who types the right word
//     would still be told they're wrong.
//   * Answers are single words with no spaces or punctuation.
//   * Six words per chain, so every puzzle is exactly four blanks and scores
//     the same as every other one.
//
// Adding puzzles is the intended way to grow this: players never get the same
// puzzle twice (see `player_word_chains_seen`), so a bigger bank is a longer
// runway before anyone starts seeing repeats. Give each new chain a stable `id`
// — that id is what the seen-history is keyed by, so renaming one makes every
// player eligible to see it again.

export interface WordChainPuzzle {
  id: string;
  /** The whole chain, first word to last. Ends are given; the rest are blanks. */
  words: string[];
}

export const WORD_CHAINS: WordChainPuzzle[] = [
  { id: "fire-pack-rat", words: ["FIRE", "FLY", "PAPER", "BACK", "PACK", "RAT"] },
  { id: "sun-service-charge", words: ["SUN", "FLOWER", "BED", "ROOM", "SERVICE", "CHARGE"] },
  { id: "rain-fast-food", words: ["RAIN", "BOW", "TIE", "BREAK", "FAST", "FOOD"] },
  { id: "horse-shop-lift", words: ["HORSE", "SHOE", "LACE", "WORK", "SHOP", "LIFT"] },
  { id: "black-side-kick", words: ["BLACK", "BOARD", "WALK", "WAY", "SIDE", "KICK"] },
  { id: "snow-mark-down", words: ["SNOW", "BALL", "PARK", "BENCH", "MARK", "DOWN"] },
  { id: "moon-up-grade", words: ["MOON", "LIGHT", "HOUSE", "HOLD", "UP", "GRADE"] },
  { id: "butter-man-hole", words: ["BUTTER", "FLY", "WHEEL", "CHAIR", "MAN", "HOLE"] },
  { id: "heart-hall-way", words: ["HEART", "BREAK", "DOWN", "TOWN", "HALL", "WAY"] },
  { id: "fire-shelf-life", words: ["FIRE", "WOOD", "WORK", "BOOK", "SHELF", "LIFE"] },
  { id: "gold-hill-side", words: ["GOLD", "FISH", "HOOK", "UP", "HILL", "SIDE"] },
  { id: "sand-game-plan", words: ["SAND", "PAPER", "CLIP", "BOARD", "GAME", "PLAN"] },
  { id: "key-hole-punch", words: ["KEY", "NOTE", "BOOK", "WORM", "HOLE", "PUNCH"] },
  { id: "water-work-force", words: ["WATER", "FALL", "BACK", "FIRE", "WORK", "FORCE"] },
  { id: "hand-up-root", words: ["HAND", "BAG", "PIPE", "LINE", "UP", "ROOT"] },
  { id: "tooth-read-out", words: ["TOOTH", "BRUSH", "FIRE", "PROOF", "READ", "OUT"] },
  { id: "dog-side-walk", words: ["DOG", "HOUSE", "WORK", "OUT", "SIDE", "WALK"] },
  { id: "rail-case-work", words: ["RAIL", "ROAD", "SIDE", "SHOW", "CASE", "WORK"] },
  { id: "silver-food-chain", words: ["SILVER", "WARE", "HOUSE", "PLANT", "FOOD", "CHAIN"] },
  { id: "eye-car-pool", words: ["EYE", "BROW", "BEAT", "BOX", "CAR", "POOL"] },
  { id: "over-power-house", words: ["OVER", "TIME", "LINE", "MAN", "POWER", "HOUSE"] },
  { id: "cup-coat-rack", words: ["CUP", "CAKE", "WALK", "OVER", "COAT", "RACK"] },
  { id: "night-water-melon", words: ["NIGHT", "FALL", "OUT", "BREAK", "WATER", "MELON"] },
  { id: "life-point-blank", words: ["LIFE", "GUARD", "RAIL", "WAY", "POINT", "BLANK"] },
  { id: "home-ground-hog", words: ["HOME", "WORK", "HORSE", "PLAY", "GROUND", "HOG"] },
  { id: "super-work-shop", words: ["SUPER", "STAR", "FISH", "NET", "WORK", "SHOP"] },
  { id: "head-up-town", words: ["HEAD", "PHONE", "BOOK", "MARK", "UP", "TOWN"] },
  { id: "back-shift-key", words: ["BACK", "BONE", "YARD", "STICK", "SHIFT", "KEY"] },
  { id: "pan-lift-off", words: ["PAN", "CAKE", "BATTER", "UP", "LIFT", "OFF"] },
  { id: "green-pass-word", words: ["GREEN", "HOUSE", "HOLD", "OVER", "PASS", "WORD"] },
  { id: "foot-room-mate", words: ["FOOT", "BALL", "GAME", "SHOW", "ROOM", "MATE"] },
  { id: "short-stick-shift", words: ["SHORT", "CUT", "BACK", "YARD", "STICK", "SHIFT"] },
  { id: "red-wheel-chair", words: ["RED", "HEAD", "BAND", "WAGON", "WHEEL", "CHAIR"] },
  { id: "tea-fire-place", words: ["TEA", "SPOON", "FEED", "BACK", "FIRE", "PLACE"] },
  { id: "air-land-scape", words: ["AIR", "BAG", "PIPE", "DREAM", "LAND", "SCAPE"] },
  { id: "fire-off-shore", words: ["FIRE", "ARM", "CHAIR", "LIFT", "OFF", "SHORE"] },
  { id: "sea-top-hat", words: ["SEA", "SHELL", "FISH", "TANK", "TOP", "HAT"] },
  { id: "hot-up-grade", words: ["HOT", "DOG", "TAG", "LINE", "UP", "GRADE"] },
  { id: "snow-life-guard", words: ["SNOW", "MAN", "POWER", "PLANT", "LIFE", "GUARD"] },
  { id: "cross-out-side", words: ["CROSS", "WALK", "OVER", "LOOK", "OUT", "SIDE"] },
];

/**
 * The comparison form of a word: letters only, uppercased. Players type with
 * whatever case, spacing and stray punctuation they like; this is what both
 * sides of the check are reduced to before comparing.
 */
export function normalizeWord(input: string): string {
  return input.replace(/[^a-zA-Z]/g, "").toUpperCase();
}

/**
 * How many letters of an answer are shown for free.
 *
 * One, normally — a bare row of dots is a guessing game, and the initial is
 * what turns it into a solvable one. But short connectors like UP or OX are all
 * initial: showing their first letter *is* showing the answer, so they start
 * fully covered and their first letter becomes something to spend a hint on.
 */
export function freeLetters(word: string): number {
  return word.length > 2 ? 1 : 0;
}
