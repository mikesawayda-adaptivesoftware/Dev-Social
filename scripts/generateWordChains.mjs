// Grows the Word Chain puzzle bank in server/wordChains.ts.
//
//   node scripts/generateWordChains.mjs [target]      # default 500
//
// Why a generator rather than 500 hand-written chains: a chain is only as good
// as its weakest link, and a link that isn't a real compound makes the puzzle
// unsolvable — a player types the right word and is told they're wrong, mid
// race. Writing chains by hand means proof-reading 2,500 links. Writing *links*
// by hand and walking them means the chains are correct by construction, and
// the only thing that needs review is the LINKS table below.
//
// So: LINKS is the source of truth and the thing to check. Everything else is
// pathfinding.
//
// Existing chains are read back out of wordChains.ts and kept, ids and all.
// That is not politeness — `player_word_chains_seen` is keyed by id, so a
// renumbered chain reads as brand new and gets dealt to players who already
// solved it. Re-running only ever appends.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BANK = join(ROOT, "server", "wordChains.ts");

const TARGET = Number(process.argv[2] ?? 500);
const CHAIN_LENGTH = 6; // 4 blanks, so every puzzle scores out of the same total
// How many chains may reuse one link. Low enough that no one link becomes a
// motif across the bank, high enough to reach the target from this many links.
const MAX_LINK_USES = 6;
// …and how many links two chains may have in common. The cap above bounds how
// often a link appears but not how much any *pair* of chains overlaps: two
// puzzles sharing 4 of their 5 links are the same puzzle wearing a hat, and
// that is what a player notices. Each of the 5 links may recur, but never in
// company.
const MAX_SHARED_LINKS = 2;

/**
 * Vetted links: KEY is a word, the value lists words that follow it to make a
 * closed compound (BACK+PACK) or a standard open phrase (PACK RAT).
 *
 * The rule for adding: the two words must join with *no* change to either one.
 * "LUCK → CHARM" is out, because the phrase is *lucky* charm and a player who
 * typed LUCK would be told they were wrong. When in doubt, leave it out — a
 * missing link costs nothing, a wrong one breaks a game.
 *
 * A word with no entry here can still appear, as the last word of a chain.
 */
const LINKS = {
  AIR: "BAG CRAFT FIELD LINE MAIL PLANE PORT TIME WAY SHOW FORCE",
  APPLE: "SAUCE PIE",
  ARM: "CHAIR REST BAND PIT",
  BACK: "BONE DROP FIRE GROUND HAND LASH LOG PACK SIDE SPACE STAGE STOP TRACK UP YARD DOOR SEAT FLIP REST BEAT",
  BAG: "PIPE LADY",
  BALL: "PARK ROOM GAME POINT BOY GOWN",
  BAND: "WAGON STAND BOX",
  BAR: "TENDER STOOL CODE FLY",
  BASE: "BALL LINE CAMP",
  BATH: "ROOM TUB ROBE TOWEL HOUSE",
  BATTER: "UP",
  BEAN: "BAG STALK",
  BEAT: "BOX",
  BED: "ROOM SIDE TIME ROCK BUG SPREAD SHEET POST",
  BELL: "BOY TOWER HOP",
  BELT: "WAY",
  BENCH: "MARK PRESS WARMER",
  BIRD: "HOUSE BATH SEED CAGE SONG",
  BLACK: "BOARD BIRD MAIL OUT SMITH TOP LIST BELT BERRY JACK",
  BLOCK: "BUSTER HEAD PARTY",
  BLUE: "BERRY PRINT BIRD JAY GRASS",
  BOARD: "WALK GAME ROOM",
  BOAT: "HOUSE LOAD YARD",
  BODY: "GUARD WORK",
  BONE: "YARD HEAD DRY",
  BOOK: "CASE MARK SHELF STORE WORM KEEPER END CLUB SHOP BAG",
  BOTTLE: "NECK CAP",
  BOW: "TIE STRING",
  BOX: "CAR OFFICE TOP SPRING",
  BOY: "FRIEND HOOD SCOUT",
  BRAIN: "STORM CHILD WASH WAVE",
  BREAD: "BOX BASKET CRUMB WINNER",
  BREAK: "FAST DOWN THROUGH WATER OUT ROOM",
  BROW: "BEAT",
  BRUSH: "FIRE STROKE",
  BURN: "OUT",
  BUS: "STOP DRIVER STATION",
  BUTTER: "FLY MILK SCOTCH KNIFE",
  CAKE: "WALK BATTER",
  CAMP: "FIRE GROUND SITE",
  CANDLE: "STICK LIGHT",
  CANDY: "CANE BAR",
  CAR: "POOL PORT WASH SICK SEAT PARK",
  CARD: "BOARD TABLE GAME",
  CARE: "TAKER FREE GIVER",
  CART: "WHEEL",
  CASE: "LOAD WORK STUDY",
  CASH: "FLOW REGISTER BACK",
  CAST: "AWAY",
  CAT: "FISH WALK NIP NAP",
  CHAIN: "SAW LINK REACTION",
  CHAIR: "MAN LIFT",
  CHALK: "BOARD",
  CHECK: "BOOK POINT LIST OUT MATE",
  CHEESE: "CAKE BURGER CLOTH",
  CHILD: "HOOD CARE",
  CLASS: "ROOM MATE ACT",
  CLIP: "BOARD ART",
  CLOCK: "WORK WISE TOWER",
  CLOUD: "BURST NINE",
  CLUB: "HOUSE",
  COAT: "RACK CHECK TAIL",
  CODE: "WORD NAME",
  COFFEE: "SHOP TABLE BREAK POT",
  COLD: "CUT FRONT SNAP",
  COOK: "BOOK OUT WARE",
  COPY: "CAT RIGHT",
  CORN: "BREAD FIELD STARCH MEAL DOG",
  COUNT: "DOWN",
  COURT: "HOUSE YARD CASE ROOM",
  COVER: "UP ALL",
  COW: "BOY BELL HIDE PIE",
  CRAB: "GRASS APPLE",
  CREAM: "PUFF",
  CROSS: "WORD WALK ROAD FIRE BOW CHECK",
  CUFF: "LINK",
  CUP: "CAKE BOARD HOLDER",
  CUT: "BACK THROAT OFF OUT",
  DATE: "BOOK LINE",
  DAY: "LIGHT DREAM BREAK TIME CARE BED",
  DEAD: "LINE LOCK END WEIGHT BEAT",
  DECK: "CHAIR",
  DESK: "TOP JOB",
  DOG: "HOUSE WOOD TAG FOOD FIGHT",
  DOOR: "BELL STEP WAY KNOB MAN MAT FRAME STOP",
  DOUBLE: "HEADER CROSS TAKE",
  DOWN: "TOWN LOAD POUR FALL STAIRS SIDE HILL GRADE TIME STREAM BEAT PLAY RIGHT",
  DRAW: "BACK BRIDGE STRING",
  DREAM: "LAND TEAM BOAT",
  DRESS: "MAKER CODE REHEARSAL",
  DRIVE: "WAY",
  DROP: "OUT KICK DOWN",
  DRUM: "STICK BEAT ROLL",
  DRY: "WALL CLEAN DOCK",
  DUST: "PAN STORM BUNNY",
  EAR: "RING ACHE DRUM SHOT PHONE MARK",
  EARTH: "QUAKE WORM",
  EGG: "SHELL PLANT ROLL NOG WHITE",
  END: "GAME ZONE",
  EVER: "GREEN",
  EYE: "BALL BROW LASH LID SIGHT WITNESS DROP PIECE WEAR",
  FACE: "VALUE LIFT PAINT",
  FALL: "OUT BACK GUY",
  FARM: "HOUSE YARD LAND HAND",
  FAST: "BALL FOOD LANE TRACK",
  FATHER: "LAND",
  FEATHER: "WEIGHT BED",
  FEED: "BACK BAG",
  FIELD: "WORK TRIP DAY GOAL",
  FINGER: "PRINT NAIL TIP",
  FIRE: "FLY PLACE WOOD WORK ARM FIGHTER PROOF BALL DRILL HOUSE SIDE TRUCK ESCAPE STORM CRACKER LIGHT",
  FIRST: "HAND AID BORN",
  FISH: "HOOK NET BOWL TANK FOOD EYE",
  FLAG: "POLE SHIP STONE",
  FLASH: "LIGHT BACK FLOOD POINT",
  FLOOD: "LIGHT GATE",
  FLOOR: "BOARD PLAN LAMP",
  FLOW: "CHART",
  FLOWER: "POT BED SHOP",
  FLY: "PAPER SWATTER WHEEL OVER",
  FOOD: "CHAIN COURT TRUCK FIGHT",
  FOOT: "BALL PRINT STEP HILL NOTE PATH WORK HOLD BRIDGE LIGHT REST LOCKER STOOL",
  FORCE: "FIELD FEED",
  FRAME: "WORK",
  FREE: "WAY LOAD STYLE FALL",
  FRIEND: "SHIP",
  FRONT: "DOOR LINE YARD PAGE",
  FRUIT: "CAKE FLY SALAD",
  FULL: "BACK TIME MOON",
  GAME: "PLAN SHOW BOARD NIGHT",
  GATE: "WAY KEEPER POST",
  GHOST: "TOWN WRITER STORY",
  GLASS: "HOUSE CEILING WARE",
  GOAL: "KEEPER POST LINE",
  GOLD: "FISH MINE SMITH RUSH",
  GRAND: "STAND FATHER MOTHER PIANO CHILD",
  GRAPE: "VINE FRUIT",
  GRASS: "HOPPER LAND ROOTS",
  GRAVE: "YARD STONE",
  GREEN: "HOUSE LIGHT BACK THUMB ROOM",
  GROUND: "WORK HOG FLOOR RULE",
  GUARD: "RAIL DOG HOUSE",
  GUN: "POWDER FIRE SHOT BOAT MAN",
  HAIR: "BRUSH CUT LINE PIN SPRAY STYLE",
  HALF: "TIME WAY MOON",
  HALL: "WAY PASS",
  HAND: "BAG BOOK CUFF MADE SHAKE STAND RAIL OUT BALL GUN TOWEL BRAKE PICK",
  HANG: "OUT OVER MAN NAIL",
  HARD: "WARE WOOD BALL HAT",
  HAT: "BOX TRICK RACK",
  HAY: "STACK WIRE RIDE",
  HEAD: "ACHE BAND LIGHT LINE PHONE QUARTERS STONE WAY COUNT HUNTER REST START SET GEAR BOARD MASTER",
  HEART: "BREAK BEAT BURN LAND ATTACK",
  HEAT: "WAVE STROKE",
  HIDE: "OUT AWAY",
  HIGH: "WAY LIGHT SCHOOL CHAIR LAND RISE JUMP",
  HILL: "SIDE TOP BILLY",
  HOLD: "UP OVER OUT",
  HOLE: "PUNCH",
  HOME: "WORK LAND MADE SICK TOWN RUN PAGE ROOM OWNER BODY COMING STEAD",
  HONEY: "MOON COMB BEE",
  HOOK: "UP SHOT",
  HORSE: "SHOE PLAY POWER BACK FLY RACE HAIR MAN",
  HOT: "DOG LINE CAKE HOUSE SPOT SAUCE PLATE HEAD",
  HOUSE: "HOLD WORK WIFE BOAT FLY PLANT KEEPER WARMING KEY COAT MATE",
  ICE: "BERG BOX CREAM CUBE BREAKER PICK SKATE CAP AGE",
  IRON: "WORK CLAD",
  JELLY: "FISH BEAN",
  JUMP: "START ROPE SUIT",
  KEEP: "SAKE",
  KEY: "BOARD HOLE NOTE STONE CHAIN CARD",
  KICK: "BACK OFF STAND",
  LACE: "WORK",
  LADY: "BUG FINGER",
  LAND: "MARK SCAPE SLIDE LORD FILL LINE FALL",
  LAP: "TOP DOG",
  LAW: "SUIT MAKER",
  LEMON: "ADE",
  LETTER: "HEAD BOX",
  LIFE: "GUARD BOAT LINE TIME STYLE RAFT SPAN LONG",
  LIFT: "OFF",
  LIGHT: "HOUSE WEIGHT BULB SWITCH YEAR",
  LIME: "LIGHT STONE",
  LINE: "UP MAN DRIVE",
  LIP: "STICK BALM SERVICE",
  LOCK: "SMITH DOWN OUT",
  LOG: "BOOK JAM CABIN",
  LONG: "HAND HORN",
  LOOK: "OUT ALIKE",
  LOVE: "LETTER BIRD SONG SICK",
  LOW: "LAND",
  LUMBER: "JACK YARD",
  MAIL: "BOX MAN ORDER",
  MAN: "HOLE POWER HUNT MADE KIND",
  MARK: "DOWN UP",
  MARKET: "PLACE",
  MASTER: "PIECE MIND KEY PLAN",
  MATCH: "BOX MAKER POINT STICK",
  MEAL: "TIME",
  MEAT: "BALL LOAF",
  MICRO: "WAVE SCOPE CHIP PHONE",
  MID: "NIGHT WAY FIELD TERM SUMMER",
  MILK: "SHAKE MAN CARTON",
  MIND: "SET GAME",
  MINE: "FIELD SHAFT",
  MOON: "LIGHT SHINE BEAM ROCK WALK",
  MOTH: "BALL",
  MOTHER: "LAND HOOD",
  MOTOR: "CYCLE BOAT BIKE WAY",
  MOUSE: "TRAP PAD",
  MOUTH: "WASH PIECE",
  MUD: "SLIDE ROOM",
  NAME: "SAKE TAG PLATE",
  NECK: "TIE LACE LINE",
  NEEDLE: "POINT",
  NEST: "EGG",
  NET: "WORK WORTH",
  NEW: "BORN COMER",
  NEWS: "PAPER STAND CAST LETTER FLASH",
  NIGHT: "FALL MARE GOWN TIME OWL CLUB LIGHT STAND SHIFT CAP WATCH",
  NORTH: "EAST WEST BOUND",
  NOTE: "BOOK PAD CARD",
  NUT: "SHELL CRACKER MEG",
  OFF: "SHORE SPRING SET SIDE BEAT HAND ROAD",
  OIL: "SPILL CHANGE FIELD",
  OUT: "SIDE BREAK FIT LAW LOOK PUT CAST DOOR FIELD LINE POST RUN COME BACK SMART NUMBER GROW REACH SOURCE WARD",
  OVER: "TIME PASS COAT LOOK BOARD HEAD LOAD NIGHT FLOW GROWN DRIVE CAST RIDE HAUL SEAS SIZE SLEEP TAKE DOSE LAP",
  PACK: "AGE HORSE RAT",
  PAINT: "BRUSH JOB",
  PAN: "CAKE HANDLE FRY",
  PAPER: "BACK CLIP WEIGHT WORK TRAIL MILL CUT",
  PARK: "WAY BENCH",
  PART: "TIME",
  PASS: "WORD PORT BOOK",
  PATH: "WAY FINDER",
  PAY: "DAY CHECK LOAD ROLL BACK PHONE",
  PEACE: "MAKER TIME",
  PEN: "KNIFE PAL",
  PEPPER: "MINT CORN",
  PHONE: "BOOK CALL BOOTH",
  PICK: "UP POCKET AXE",
  PIE: "CRUST CHART",
  PIG: "PEN TAIL SKIN IRON",
  PILLOW: "CASE TALK FIGHT",
  PIN: "POINT BALL WHEEL STRIPE CUSHION",
  PINE: "APPLE CONE TREE",
  PIPE: "LINE DREAM ORGAN",
  PIT: "FALL STOP",
  PLACE: "MAT SETTING HOLDER",
  PLANT: "FOOD LIFE",
  PLAY: "GROUND HOUSE MATE BACK BOOK PEN WRIGHT DATE OFF ROOM TIME LIST",
  POCKET: "BOOK KNIFE WATCH",
  POINT: "BLANK",
  POOL: "SIDE",
  POP: "CORN UP",
  POST: "CARD MAN MARK OFFICE BOX GAME",
  POT: "LUCK HOLE ROAST HOLDER",
  POWER: "HOUSE PLANT PLAY LINE BOAT",
  PRESS: "RELEASE ROOM",
  PRINT: "OUT SHOP",
  PROOF: "READ",
  PULL: "OVER UP",
  PUNCH: "LINE CARD BOWL",
  PUSH: "OVER BACK UP CART",
  QUICK: "SAND SILVER",
  RACE: "TRACK HORSE CAR",
  RAIL: "ROAD WAY CAR",
  RAIN: "BOW COAT DROP FALL STORM CHECK WATER FOREST MAKER",
  RATTLE: "SNAKE",
  READ: "OUT",
  RED: "HEAD WOOD CARPET LINE",
  REST: "ROOM AREA",
  RING: "TONE SIDE LEADER FINGER",
  RIVER: "BANK BED SIDE",
  ROAD: "BLOCK SIDE MAP TRIP WORK RUNNER RAGE HOUSE BED",
  ROCK: "SLIDE BAND STAR",
  ROLL: "OUT OVER CALL",
  ROOF: "TOP",
  ROOM: "MATE SERVICE",
  ROOT: "BEER STOCK",
  ROSE: "BUD WOOD",
  ROUND: "UP ABOUT TABLE HOUSE",
  RULE: "BOOK",
  RUN: "WAY AROUND OFF DOWN",
  RUSH: "HOUR",
  SAFE: "GUARD HOUSE",
  SAIL: "BOAT",
  SALT: "WATER SHAKER",
  SAND: "PAPER BOX STORM BAG CASTLE BAR STONE",
  SAW: "DUST MILL",
  SCARE: "CROW",
  SCHOOL: "WORK HOUSE YARD BUS TEACHER BOOK",
  SCORE: "BOARD CARD KEEPER",
  SCREEN: "PLAY SHOT DOOR",
  SEA: "SHELL SHORE SIDE WEED FOOD PORT SICK LEVEL HORSE GULL MAN PLANE",
  SEAT: "BELT BACK",
  SERVICE: "CHARGE ROAD STATION",
  SET: "BACK UP",
  SHADOW: "BOX PLAY",
  SHARP: "SHOOTER",
  SHEEP: "DOG SKIN",
  SHELF: "LIFE",
  SHELL: "FISH SHOCK",
  SHIFT: "KEY WORK",
  SHIP: "YARD WRECK MATE",
  SHOCK: "WAVE",
  SHOE: "LACE HORN BOX MAKER STORE",
  SHOP: "LIFT KEEPER FLOOR",
  SHORE: "LINE BIRD",
  SHORT: "CUT HAND CAKE STOP LIST CIRCUIT",
  SHOT: "GUN CLOCK PUT",
  SHOW: "CASE DOWN ROOM TIME BOAT BUSINESS STOPPER GIRL",
  SIDE: "WALK KICK LINE SHOW STEP BAR CAR BOARD DISH TRACK SWIPE ARM",
  SIGN: "POST LANGUAGE",
  SILK: "WORM",
  SILVER: "WARE FISH LINING",
  SKATE: "BOARD PARK",
  SKIN: "CARE DEEP",
  SKY: "LINE SCRAPER LIGHT DIVER",
  SLEEP: "OVER WALK MASK",
  SLIDE: "SHOW RULE",
  SLING: "SHOT",
  SLIP: "KNOT COVER",
  SMOKE: "STACK SCREEN HOUSE",
  SNAKE: "SKIN BITE",
  SNOW: "BALL MAN FLAKE STORM PLOW FALL SHOE DRIFT MOBILE BIRD SUIT CAP",
  SOAP: "BOX OPERA DISH",
  SOFT: "WARE BALL WOOD",
  SONG: "BIRD WRITER BOOK",
  SOUND: "TRACK PROOF WAVE CHECK",
  SOUTH: "EAST WEST BOUND",
  SPACE: "SHIP CRAFT STATION SUIT BAR WALK",
  SPARK: "PLUG",
  SPEAR: "MINT HEAD",
  SPEED: "BOAT WAY BUMP LIMIT",
  SPIDER: "WEB",
  SPOON: "FEED",
  SPOT: "LIGHT CHECK",
  SPRING: "TIME BOARD BREAK WATER",
  SPY: "GLASS",
  STAGE: "COACH FRIGHT HAND",
  STAIR: "CASE WAY WELL",
  STAND: "BY POINT OUT STILL UP",
  STAR: "FISH LIGHT DUST POWER",
  STEAM: "BOAT ROLLER ENGINE SHIP",
  STEP: "LADDER SON STOOL",
  STICK: "SHIFT UP",
  STOCK: "HOLDER PILE ROOM YARD",
  STONE: "WALL WARE MASON",
  STOP: "WATCH LIGHT OVER GAP",
  STORE: "FRONT ROOM KEEPER",
  STORM: "CLOUD DRAIN",
  STRAW: "BERRY MAN HAT",
  STREAM: "LINE",
  STREET: "LIGHT CAR CORNER SMART",
  SUGAR: "CANE CUBE BOWL",
  SUIT: "CASE JACKET",
  SUMMER: "TIME CAMP SCHOOL",
  SUN: "FLOWER LIGHT SHINE BURN GLASSES RISE SET SPOT BLOCK BEAM ROOF DOWN BATH DIAL TAN SCREEN STROKE",
  SUPER: "STAR MARKET MAN POWER MODEL HERO",
  SWEET: "HEART TOOTH CORN",
  SWIM: "SUIT WEAR TEAM",
  SWITCH: "BOARD",
  SWORD: "FISH",
  TABLE: "TOP CLOTH TENNIS SPOON",
  TAG: "LINE TEAM",
  TAIL: "GATE LIGHT SPIN WIND BONE",
  TAKE: "OUT OVER OFF",
  TANK: "TOP",
  TAPE: "MEASURE DECK",
  TEA: "CUP POT SPOON BAG PARTY HOUSE",
  TEAM: "WORK MATE PLAYER",
  TEAR: "DROP DUCT",
  TELE: "PHONE SCOPE VISION GRAM",
  TEST: "DRIVE TUBE RUN",
  THUMB: "NAIL TACK PRINT",
  THUNDER: "STORM CLOUD BOLT",
  TIDE: "POOL",
  TIE: "BREAK CLIP",
  TIGHT: "ROPE",
  TIME: "LINE TABLE KEEPER OUT ZONE PIECE BOMB SHARE FRAME CARD",
  TIP: "OFF JAR",
  TOAD: "STOOL",
  TOE: "NAIL HOLD",
  TOMB: "STONE",
  TOOL: "BOX BAR SHED KIT",
  TOOTH: "BRUSH PASTE PICK ACHE",
  TOP: "SOIL HAT SIDE GUN COAT NOTCH",
  TORCH: "LIGHT",
  TOUCH: "DOWN STONE SCREEN",
  TOWN: "HALL HOUSE SQUARE",
  TRACK: "RECORD MEET",
  TRADE: "MARK OFF",
  TRAIN: "STATION WRECK TRACK",
  TRAP: "DOOR",
  TREE: "HOUSE TOP LINE TRUNK",
  TRUCK: "DRIVER STOP LOAD",
  TURN: "AROUND TABLE OUT OVER PIKE STILE",
  UNDER: "COVER GROUND LINE TAKE DOG PASS STAND CUT WEAR WORLD WATER ARM AGE FOOT RATE",
  UP: "HILL STAIRS STREAM ROOT GRADE TOWN SET SIDE DATE LOAD RIGHT LIFT KEEP BEAT TIGHT TURN SCALE WIND STATE",
  WAGON: "WHEEL TRAIN",
  WAIST: "LINE BAND",
  WALK: "WAY OUT OVER",
  WALL: "PAPER FLOWER CLOCK",
  WAR: "SHIP HEAD PATH ZONE TIME",
  WARE: "HOUSE",
  WASH: "CLOTH ROOM OUT BOARD BASIN",
  WATCH: "DOG TOWER WORD MAN",
  WATER: "FALL MELON PROOF MARK WAY COLOR SHED FRONT BOTTLE LINE TOWER",
  WAVE: "LENGTH",
  WAY: "SIDE POINT",
  WEATHER: "MAN PROOF VANE",
  WEB: "SITE PAGE",
  WEEK: "END NIGHT DAY",
  WEIGHT: "ROOM",
  WHEEL: "CHAIR BARROW HOUSE",
  WHIRL: "POOL WIND",
  WHITE: "BOARD WASH HOUSE OUT WATER",
  WILD: "FIRE LIFE FLOWER CAT",
  WIND: "MILL SHIELD STORM PIPE FALL CHIME BREAKER SOCK SURF",
  WINDOW: "SILL PANE SHOP",
  WING: "SPAN MAN TIP",
  WINTER: "TIME COAT",
  WIRE: "TAP CUTTER",
  WISH: "BONE LIST",
  WONDER: "LAND",
  WOOD: "WORK PECKER LAND PILE STOVE CUTTER SHED WIND",
  WORD: "PLAY SEARCH COUNT",
  WORK: "SHOP BOOK HORSE OUT PLACE LOAD FORCE BENCH DAY MAN SHEET STATION FLOW SPACE WEEK",
  WORLD: "WIDE WAR CLASS",
  WORM: "HOLE",
  YARD: "STICK SALE WORK",
  YEAR: "BOOK END",
  ZIP: "CODE LINE",
};

const adjacency = new Map(
  Object.entries(LINKS).map(([from, to]) => [from, to.split(" ")])
);

/** Deterministic PRNG, so re-running produces the same bank. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260816);

function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Existing bank -------------------------------------------------------

const source = readFileSync(BANK, "utf8");
const existing = [
  ...source.matchAll(/\{\s*id:\s*"([^"]+)",\s*words:\s*\[([^\]]+)\]\s*\}/g),
].map(([, id, list]) => ({
  id,
  words: [...list.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]),
}));

const chains = [...existing];
const usedIds = new Set(existing.map((c) => c.id));
const seenChains = new Set(existing.map((c) => c.words.join(" ")));
const linkUses = new Map();
/** linkKey -> indices of the chains using it, for the overlap check. */
const chainsByLink = new Map();

const linkKey = (a, b) => `${a}>${b}`;

const linksOf = (words) =>
  words.slice(0, -1).map((word, i) => linkKey(word, words[i + 1]));

/**
 * Record which chain uses which links, for the overlap check.
 *
 * Deliberately separate from the `linkUses` tally: a successful `findChain`
 * has already spent that budget on the way down and leaves it spent, so doing
 * both here would charge every link twice.
 */
function indexChain(words, index) {
  for (const key of linksOf(words)) {
    const users = chainsByLink.get(key);
    if (users) {
      users.push(index);
    } else {
      chainsByLink.set(key, [index]);
    }
  }
}

/** True when some existing chain shares more than MAX_SHARED_LINKS links. */
function tooSimilar(words) {
  const overlap = new Map();
  for (const key of linksOf(words)) {
    for (const index of chainsByLink.get(key) ?? []) {
      const count = (overlap.get(index) ?? 0) + 1;
      if (count > MAX_SHARED_LINKS) {
        return true;
      }
      overlap.set(index, count);
    }
  }
  return false;
}

// Existing chains spend from the same budgets, so new ones neither pile onto
// links the shipped puzzles lean on nor shadow the puzzles themselves.
existing.forEach((chain, i) => {
  for (const key of linksOf(chain.words)) {
    linkUses.set(key, (linkUses.get(key) ?? 0) + 1);
  }
  indexChain(chain.words, i);
});

// --- Path search ---------------------------------------------------------

/** Depth-first walk for one chain starting at `start`, or null. */
function findChain(start) {
  const path = [start];
  const taken = [];

  function step() {
    if (path.length === CHAIN_LENGTH) {
      return !seenChains.has(path.join(" ")) && !tooSimilar(path);
    }
    const here = path[path.length - 1];
    for (const next of shuffled(adjacency.get(here) ?? [])) {
      // A repeated word inside one chain reads as a mistake, and makes the
      // puzzle ambiguous when the repeat is one of the blanks.
      if (path.includes(next)) {
        continue;
      }
      const key = linkKey(here, next);
      if ((linkUses.get(key) ?? 0) >= MAX_LINK_USES) {
        continue;
      }
      path.push(next);
      taken.push(key);
      linkUses.set(key, (linkUses.get(key) ?? 0) + 1);
      if (step()) {
        return true;
      }
      path.pop();
      linkUses.set(key, linkUses.get(key) - 1);
      taken.pop();
    }
    return false;
  }

  return step() ? [...path] : null;
}

/** `first-last`, disambiguated only when it has to be. Stable for a given run. */
function makeId(words) {
  const base = `${words[0]}-${words[words.length - 1]}`.toLowerCase();
  if (!usedIds.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

// Round-robin over start words rather than draining one hub at a time, so the
// bank doesn't open with fifty chains that all begin with FIRE.
const starts = shuffled([...adjacency.keys()]);
let exhausted = 0;

while (chains.length < TARGET && exhausted < starts.length) {
  exhausted = 0;
  for (const start of starts) {
    if (chains.length >= TARGET) {
      break;
    }
    const words = findChain(start);
    if (!words) {
      exhausted++;
      continue;
    }
    const id = makeId(words);
    usedIds.add(id);
    seenChains.add(words.join(" "));
    indexChain(words, chains.length);
    chains.push({ id, words });
  }
}

// --- Validate ------------------------------------------------------------
//
// Belt and braces. The walk can only follow LINKS, so these should never fire —
// but this file is the one place a bad chain could reach players, and a puzzle
// nobody can solve is worth a loud failure here rather than a quiet one live.

const problems = [];
const ids = new Set();
for (const { id, words } of chains) {
  if (ids.has(id)) {
    problems.push(`duplicate id ${id}`);
  }
  ids.add(id);
  if (words.length !== CHAIN_LENGTH) {
    problems.push(`${id}: ${words.length} words, expected ${CHAIN_LENGTH}`);
  }
  if (new Set(words).size !== words.length) {
    problems.push(`${id}: repeats a word`);
  }
  for (const word of words) {
    if (!/^[A-Z]+$/.test(word)) {
      problems.push(`${id}: "${word}" isn't plain uppercase letters`);
    }
  }
  for (let i = 0; i < words.length - 1; i++) {
    if (!(adjacency.get(words[i]) ?? []).includes(words[i + 1])) {
      problems.push(`${id}: ${words[i]} + ${words[i + 1]} is not a known link`);
    }
  }
}
if (problems.length) {
  console.error(`REFUSING TO WRITE — ${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`  ${p}`);
  }
  process.exit(1);
}

// --- Emit ----------------------------------------------------------------
//
// Only the array literal is replaced; the header, types and helpers around it
// are hand-maintained and stay put.

const body = chains
  .map(
    ({ id, words }) =>
      `  { id: ${JSON.stringify(id)}, words: [${words
        .map((w) => JSON.stringify(w))
        .join(", ")}] },`
  )
  .join("\n");

const replaced = source.replace(
  /(export const WORD_CHAINS: WordChainPuzzle\[\] = \[)[\s\S]*?(\n\];)/,
  (_, open, close) => `${open}\n${body}${close}`
);

if (replaced === source && chains.length !== existing.length) {
  console.error("Could not find the WORD_CHAINS array to replace.");
  process.exit(1);
}

writeFileSync(BANK, replaced);

const added = chains.length - existing.length;
const distinctStarts = new Set(chains.map((c) => c.words[0])).size;
const distinctWords = new Set(chains.flatMap((c) => c.words)).size;
// Counted off the chains, not off `linkUses` — the search leaves a zeroed entry
// behind for every link it tried and backed out of, which would report links as
// "in play" that no puzzle actually uses.
const linksInPlay = new Set(chains.flatMap((c) => linksOf(c.words))).size;
const linkTotal = [...adjacency.values()].reduce((n, t) => n + t.length, 0);
console.log(
  `${chains.length} chains (${existing.length} kept, ${added} added)\n` +
    `${distinctStarts} distinct opening words, ${distinctWords} distinct words used\n` +
    `${linksInPlay} of ${linkTotal} links in play, at most ${MAX_LINK_USES} uses ` +
    `each and at most ${MAX_SHARED_LINKS} shared between any two chains`
);
if (chains.length < TARGET) {
  console.log(
    `\nShort of ${TARGET}. The graph is spent at this reuse cap — add links to ` +
      `LINKS, or raise MAX_LINK_USES and accept more overlap between puzzles.`
  );
}
