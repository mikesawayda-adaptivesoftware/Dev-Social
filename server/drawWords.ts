// Words to draw.
//
// Unlike the Word Chain bank there is nothing here to get factually wrong — a
// word is not a claim. What a word can be is *undrawable*, so the bar for
// adding one is: could a person with no artistic talent get this across in
// sixty seconds, using only a pen?
//
// That rules out most abstractions. It does not rule out all of them — the hard
// tier leans on ideas you have to be clever about, which is where the good
// drawings come from — but every hard word here has at least one obvious visual
// route.
//
// Difficulty is a hand-made judgement, not a computed one. There's no graph to
// measure against the way there was for chains; "how hard is this to draw" is
// exactly the kind of thing a person is better at than a metric.
//
// The `id` is what `player_draw_words_seen` is keyed by, so it must stay stable.
// It's the lowercased word, which means renaming a word re-deals it to everyone
// who has already had it. Add words freely; edit them carefully.

import type { DrawDifficulty } from "../src/shared/types";

export interface DrawWord {
  id: string;
  word: string;
  difficulty: DrawDifficulty;
}

const EASY = [
  "cat", "dog", "house", "sun", "moon", "star", "tree", "car", "boat", "fish",
  "apple", "banana", "hat", "shoe", "book", "clock", "key", "door", "chair",
  "table", "cup", "spoon", "bed", "eye", "hand", "foot", "nose", "smile",
  "heart", "flower", "cloud", "rain", "snowman", "balloon", "ball", "kite",
  "ladder", "bridge", "train", "plane", "rocket", "bicycle", "umbrella",
  "candle", "cake", "pizza", "egg", "carrot", "mushroom", "snake", "spider",
  "bird", "duck", "owl", "bee", "butterfly", "crab", "whale", "elephant",
  "giraffe", "penguin", "frog", "turtle", "mouse", "pig", "cow", "sheep",
  "bone", "fence", "mountain", "island", "camera", "guitar", "drum", "phone",
  "glasses", "sock", "crown", "sword", "anchor",
];

const NORMAL = [
  "lighthouse", "windmill", "castle", "igloo", "treehouse", "campfire",
  "waterfall", "volcano", "desert", "rainbow", "tornado", "iceberg",
  "submarine", "helicopter", "tractor", "skateboard", "parachute", "telescope",
  "microscope", "hourglass", "compass", "typewriter", "vending machine",
  "traffic jam", "roller coaster", "ferris wheel", "escalator", "trampoline",
  "hammock", "wheelbarrow", "scarecrow", "beehive", "birdcage", "fishbowl",
  "piggy bank", "jigsaw puzzle", "chess board", "dartboard", "bowling",
  "juggling", "tightrope", "magic trick", "haircut", "dentist", "librarian",
  "astronaut", "pirate", "wizard", "detective", "chef", "referee", "mermaid",
  "dragon", "unicorn", "robot", "zombie", "ghost", "skeleton", "vampire",
  "octopus", "jellyfish", "seahorse", "hedgehog", "sloth", "flamingo",
  "peacock", "chameleon", "porcupine", "walrus", "narwhal", "platypus",
  "sandcastle", "snow globe", "treasure map", "message in a bottle",
  "shooting star", "solar eclipse", "northern lights",
];

const HARD = [
  "gravity", "echo", "shadow", "reflection", "silence", "gossip", "jealousy",
  "nostalgia", "deja vu", "insomnia", "hiccups", "sneeze", "yawn", "tickle",
  "shiver", "dizzy", "lost", "late", "early bird", "night owl", "procrastinate",
  "multitask", "overthink", "eavesdrop", "photobomb", "small talk",
  "awkward silence", "cold shoulder", "mixed signals", "wild goose chase",
  "elephant in the room", "tip of the iceberg", "break the ice",
  "spill the beans", "piece of cake", "under the weather", "cost an arm and a leg",
  "raining cats and dogs", "bite the bullet", "hit the hay", "cold feet",
  "butterflies in your stomach", "back to square one", "burning the midnight oil",
  "the last straw", "a blessing in disguise", "once in a blue moon",
  "time flies", "chain reaction", "domino effect", "growing pains",
  "culture shock", "writer's block", "brain freeze", "food coma", "power nap",
  "wifi dead zone", "software update", "group project", "inbox zero",
  "meeting that could have been an email",
];

const build = (words: string[], difficulty: DrawDifficulty): DrawWord[] =>
  words.map((word) => ({ id: word.toLowerCase(), word, difficulty }));

export const DRAW_WORDS: DrawWord[] = [
  ...build(EASY, "easy"),
  ...build(NORMAL, "normal"),
  ...build(HARD, "hard"),
];

/**
 * The comparison form of a guess: letters and digits only, lowercased.
 *
 * Deliberately drops spaces and punctuation, so "deja vu", "dejavu" and
 * "Déjà-vu" all land on the same string — a player who has the answer should
 * never lose a race to how they punctuated it.
 */
export function normalizeGuess(input: string): string {
  return (
    input
      // NFD splits "é" into "e" + a combining accent, and the filter below drops
      // the accent along with everything else that isn't a letter or digit — so
      // "déjà vu", "dejavu" and "Deja-Vu" all reduce to the same string.
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
  );
}

/**
 * What guessers see instead of the word: letters as underscores, spaces kept.
 * Enough to show the shape — two short words versus one long one — without
 * giving away a single letter.
 */
export function maskWord(word: string): string {
  return word.replace(/[^\s]/g, "_");
}
