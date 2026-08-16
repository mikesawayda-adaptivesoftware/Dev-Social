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

/**
 * How many chains to hold at each length. Per length, not in total: each is its
 * own never-repeat pool.
 *
 * Sized to how much of each anyone will actually play, not evenly. A short
 * chain is a two-minute round you might do a dozen of in a session; a marathon
 * is most of a five-minute game, so sixty of them is years of Fridays. Long
 * chains are also much the most expensive to search for, and chasing hundreds
 * of them costs far more time than the extra runway is worth.
 *
 * An argument overrides every length, for when you want to push a pool up.
 */
const override = process.argv[2] ? Number(process.argv[2]) : null;
const TARGETS = { 5: 400, 6: 500, 8: 250, 12: 120, 17: 60 };
const targetFor = (length) => override ?? TARGETS[length] ?? 100;
// Chain lengths the host can choose between, in words. Blanks are two fewer,
// so these are 3, 4, 6, 10 and 15 links. Scoring is normalised per blank (see
// server/rooms.ts), so a short chain is worth exactly as much as a long one.
const CHAIN_LENGTHS = [5, 6, 8, 12, 17];
// How many chains may reuse one link. Every chain spends one use per link, and
// a long chain spends many, so this has to clear the average demand across the
// whole bank with room to spare — the pairwise cap below is what actually keeps
// puzzles from resembling each other.
const MAX_LINK_USES = 60;

/**
 * How many links two chains of the same length may have in common.
 *
 * A *share* of the chain rather than a fixed count. Two puzzles overlapping in
 * half their links are the same puzzle wearing a hat, and that's what a player
 * notices — but "no more than 2" means 50% of a four-link chain and 12% of a
 * sixteen-link one, so a flat number silently throttles long chains to nothing.
 * That's what capped the eight-word pool at 151 when the graph had plenty.
 *
 * Only chains of the *same* length are compared, for two reasons. Players draw
 * from a per-length pool, so "I've seen this puzzle before" can only happen
 * within one. And a three-blank chain sitting inside a fifteen-blank one isn't
 * a repeat by any measure a player would recognise — while treating it as one
 * makes long chains nearly impossible to find, because the short chains have
 * already blanketed the same hub words.
 *
 * MAX_LINK_USES is what stops a link becoming ubiquitous across the whole bank.
 */
const MAX_SHARED_FRACTION = 0.4;
const maxSharedFor = (length) =>
  Math.max(2, Math.round((length - 1) * MAX_SHARED_FRACTION));

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

/** The same graph backwards, for approaching a blank from the word below it. */
const reverse = new Map();
for (const [from, targets] of adjacency) {
  for (const to of targets) {
    const sources = reverse.get(to);
    if (sources) {
      sources.push(from);
    } else {
      reverse.set(to, [from]);
    }
  }
}

/**
 * Letters of an answer shown for free. Must match `freeLetters` in
 * server/wordChains.ts — this is the model of what the player can see, and the
 * uniqueness guarantee below is only worth anything if it matches reality.
 */
const freeLetters = (word) => (word.length > 2 ? 1 : 0);

/**
 * Every word that fits a blank as far as the player can tell: it links to the
 * neighbour they're working from, and it matches the length and the free
 * letters on show.
 */
function candidates(neighbour, answer, direction) {
  const pool =
    (direction === "down" ? adjacency.get(neighbour) : reverse.get(neighbour)) ??
    [];
  const shown = answer.slice(0, freeLetters(answer));
  return pool.filter(
    (word) => word.length === answer.length && word.startsWith(shown)
  );
}

/**
 * How hard one blank is: the number of words that fit its *shape* — right
 * length, right neighbour — before the free first letter narrows it down.
 *
 * One means the length alone gives it away. Eight means the player has to hold
 * the letter in mind and work through the options, which is the difference
 * between filling a chain and solving one. Taken as the smaller of the two
 * directions, because a player works from whichever end is easier.
 */
function blankEffort(words, i) {
  const answer = words[i];
  const fits = (neighbour, direction) => {
    const pool =
      (direction === "down"
        ? adjacency.get(neighbour)
        : reverse.get(neighbour)) ?? [];
    return pool.filter((word) => word.length === answer.length).length;
  };
  return Math.min(
    fits(words[i - 1], "down"),
    fits(words[i + 1], "up")
  );
}

/**
 * A chain's difficulty: the average effort of its blanks.
 *
 * An average rather than a total, because chains come in several lengths now
 * and a six-blank chain would otherwise score as "hard" purely for being long.
 * What the tier should say is how hard the blanks are, not how many there are.
 */
function chainEffort(words) {
  let total = 0;
  for (let i = 1; i < words.length - 1; i++) {
    total += blankEffort(words, i);
  }
  return total / (words.length - 2);
}

// Cut points from the score distribution across the bank, which is skewed low:
// they split it near evenly rather than into equal score ranges. Recompute them
// if the length mix or the link graph changes much — they're the 33rd and 67th
// percentiles of the actual spread, not round numbers.
//
// Honest about what this measures: how much narrowing the free letter has to do
// inside *our* link graph, not how obscure the compound is in English. A blank
// the graph pins by length alone can still need a word you'd not have thought
// of. It's a good knob, not a promise.
// Cut points sit just above 4/3 and 7/4 so the common exact fractions land on
// the intended side rather than on a floating-point coin toss.
const EASY_AT_MOST = 1.34;
const NORMAL_AT_MOST = 1.76;

function difficultyOf(words) {
  const effort = chainEffort(words);
  if (effort <= EASY_AT_MOST) {
    return "easy";
  }
  return effort <= NORMAL_AT_MOST ? "normal" : "hard";
}

/**
 * True when every blank has exactly one answer, from both directions.
 *
 * This is the difference between a puzzle and a guessing game. A blank is
 * presented as "a word that follows BED, four letters, starts with R" — and if
 * both ROOM and ROCK satisfy that, then a player who types ROCK has solved the
 * puzzle as posed and is told they're wrong. Mid race, that's the worst moment
 * the game can produce.
 *
 * Checked in both directions because a player may work up from the last word as
 * well as down from the first, and a blank that is unique one way round can have
 * two answers the other.
 */
function wellPosed(words) {
  for (let i = 1; i < words.length - 1; i++) {
    if (candidates(words[i - 1], words[i], "down").length !== 1) {
      return false;
    }
    if (candidates(words[i + 1], words[i], "up").length !== 1) {
      return false;
    }
  }
  return true;
}

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

// `[^}]*` after the word list so that fields added later (difficulty, and
// whatever comes next) don't make existing chains invisible to the reader —
// which would silently renumber the whole bank.
const source = readFileSync(BANK, "utf8");
const found = [
  ...source.matchAll(/\{\s*id:\s*"([^"]+)",\s*words:\s*\[([^\]]+)\][^}]*\}/g),
].map(([, id, list]) => ({
  id,
  words: [...list.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]),
}));

// Existing chains are re-checked, not trusted. Growing LINKS can retroactively
// give an old blank a second answer, and a puzzle that can tell a correct player
// they're wrong is worth losing. Dropping one is safe: `player_word_chains_seen`
// rows for an id no longer in the bank simply never match anything.
const existing = found.filter((c) => wellPosed(c.words));
const dropped = found.filter((c) => !wellPosed(c.words));

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

/** True when a chain of the same length shares too many links with this one. */
function tooSimilar(words) {
  const allowed = maxSharedFor(words.length);
  const overlap = new Map();
  for (const key of linksOf(words)) {
    for (const index of chainsByLink.get(key) ?? []) {
      if (chains[index].words.length !== words.length) {
        continue;
      }
      const count = (overlap.get(index) ?? 0) + 1;
      if (count > allowed) {
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

/** Depth-first walk for one chain of `length` starting at `start`, or null. */
function findChain(start, length) {
  const path = [start];
  const taken = [];

  function step() {
    if (path.length === length) {
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
      // Adding `next` fixes both neighbours of the blank behind it, so that
      // blank can be judged now. Checking here rather than at full length is
      // what makes long chains findable at all: a dead end four words in is
      // abandoned immediately instead of after exploring everything below it.
      if (path.length >= 2) {
        const i = path.length - 1;
        if (
          candidates(path[i - 1], path[i], "down").length !== 1 ||
          candidates(next, path[i], "up").length !== 1
        ) {
          continue;
        }
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
const countAtLength = (length) =>
  chains.filter((c) => c.words.length === length).length;

// Longest first. Long chains are the scarce ones — they need more consecutive
// well-posed links — so they get first call on the link budget rather than
// picking through what the short ones left behind.
for (const length of [...CHAIN_LENGTHS].sort((a, b) => b - a)) {
  const target = targetFor(length);
  const before = countAtLength(length);
  let exhausted = 0;
  while (countAtLength(length) < target && exhausted < starts.length) {
    exhausted = 0;
    for (const start of starts) {
      if (countAtLength(length) >= target) {
        break;
      }
      const words = findChain(start, length);
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
  // Progress as it happens. Long lengths take minutes, and a silent run gives
  // no way to tell searching from hanging.
  const added = countAtLength(length) - before;
  process.stdout.write(
    `${length} words: ${countAtLength(length)}/${target}` +
      `${added ? ` (+${added})` : ""}\n`
  );
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
  if (!CHAIN_LENGTHS.includes(words.length)) {
    problems.push(
      `${id}: ${words.length} words, expected one of ${CHAIN_LENGTHS.join("/")}`
    );
  }
  if (new Set(words).size !== words.length) {
    problems.push(`${id}: repeats a word`);
  }
  for (const word of words) {
    if (!/^[A-Z]+$/.test(word)) {
      problems.push(`${id}: "${word}" isn't plain uppercase letters`);
    }
  }
  if (!["easy", "normal", "hard"].includes(difficultyOf(words))) {
    problems.push(`${id}: scored into no difficulty tier`);
  }
  for (let i = 0; i < words.length - 1; i++) {
    if (!(adjacency.get(words[i]) ?? []).includes(words[i + 1])) {
      problems.push(`${id}: ${words[i]} + ${words[i + 1]} is not a known link`);
    }
  }
  for (let i = 1; i < words.length - 1; i++) {
    for (const [dir, neighbour] of [
      ["down", words[i - 1]],
      ["up", words[i + 1]],
    ]) {
      const fits = candidates(neighbour, words[i], dir);
      if (fits.length !== 1) {
        problems.push(
          `${id}: going ${dir} from ${neighbour}, blank ${i} accepts ${fits.join(
            "/"
          )} — must accept only ${words[i]}`
        );
      }
    }
  }
}
// A length the lobby offers but the bank can't supply is worse than a missing
// option: the host picks "Marathon", the fallback quietly hands them a standard
// chain, and nothing anywhere says why. Catch it here, where it's a build-time
// failure, rather than live.
for (const length of CHAIN_LENGTHS) {
  if (countAtLength(length) === 0) {
    problems.push(
      `no chains at ${length} words — remove it from CHAIN_LENGTHS (and from ` +
        `WORD_CHAIN_LENGTH_OPTIONS in src/shared/types.ts) or generate some`
    );
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

// Difficulty is recomputed for every chain, kept ones included — it's derived
// from the link graph, so growing LINKS can legitimately move a chain between
// tiers. Only the id is sacred.
const body = chains
  .map(
    ({ id, words }) =>
      `  { id: ${JSON.stringify(id)}, words: [${words
        .map((w) => JSON.stringify(w))
        .join(", ")}], difficulty: ${JSON.stringify(difficultyOf(words))} },`
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
const tiers = chains.reduce((counts, c) => {
  const tier = difficultyOf(c.words);
  counts[tier] = (counts[tier] ?? 0) + 1;
  return counts;
}, {});
const byLength = CHAIN_LENGTHS.map(
  (n) => `${countAtLength(n)} of ${n} words`
).join(", ");
console.log(
  `${chains.length} chains (${existing.length} kept, ${added} added` +
    `${dropped.length ? `, ${dropped.length} dropped as ambiguous` : ""})\n` +
    `lengths: ${byLength}\n` +
    `${distinctStarts} distinct opening words, ${distinctWords} distinct words used\n` +
    `${linksInPlay} of ${linkTotal} links in play, at most ${MAX_LINK_USES} uses ` +
    `each and at most ${Math.round(MAX_SHARED_FRACTION * 100)}% shared between ` +
    `any two chains\n` +
    `difficulty: ${tiers.easy ?? 0} easy, ${tiers.normal ?? 0} normal, ${
      tiers.hard ?? 0
    } hard`
);
const short = CHAIN_LENGTHS.filter((n) => countAtLength(n) < targetFor(n));
if (short.length) {
  console.log(
    `\nShort of target at ${short.join("/")} words. Raise MAX_SHARED_FRACTION ` +
      `to allow long chains more overlap with each other, raise MAX_LINK_USES, ` +
      `or add links to LINKS.`
  );
}
