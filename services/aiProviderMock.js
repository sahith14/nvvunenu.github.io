// services/aiProviderMock.js — Demo AI provider for testing.
// =====================================================================
// Drop-in object you can assign to window.__AI_PROVIDER__ to see how
// each AI surface looks once a real LLM/STT is plugged in. Returns
// gentle canned strings — never calls out to the network.
// =====================================================================

const TRANSCRIPTS = [
  "Hey, just checking in. Hope your day is treating you sweetly.",
  "I keep thinking about the rain we walked through last weekend. Tell me again why we love it?",
  "Goodnight. I'll dream of small joys.",
  "I made the soup again and it's slightly better. You'd have notes.",
  "I love you. That's all. Carry on with your meeting.",
];

const REPLIES = [
  ["💜",          "Tell me more",  "I missed that part",   "Send pics?"],
  ["🥰",          "Same",          "I'm proud of you",     "What time?"],
  ["I'll be there", "Soon ✨",     "Save me a seat",       "Bring snacks?"],
  ["Cuddles incoming", "Already?", "Tell me everything",   "Hold on, brb"],
];

const RECAPS = [
  "You shared 47 messages, swapped two playlists, and 5 mornings started with hellos before either of you was fully awake. That's a soft, steady week.",
  "Light week — a little quiet on the kindness side, but the date you marked done on Saturday says everything. Plan another?",
  "Rough day on Tuesday, then a string of laughing emojis on Wednesday. The bond moved up 8 points. Keep choosing.",
];

const CAPTIONS = [
  "Late afternoon light through the curtains, the kind that makes ordinary look gold.",
  "A small moment, kept warm.",
  "Saturday tea and the slow-burning quiet between us.",
  "The walk where we said nothing for a mile and felt closer for it.",
  "Two cups, two spoons, exactly enough.",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export const aiProviderMock = {
  async transcribe(_audioUrl) {
    await delay(700);
    return pick(TRANSCRIPTS);
  },
  async suggestReplies(_messages, _count = 4) {
    await delay(250);
    return pick(REPLIES);
  },
  async recapWeek(_summary) {
    await delay(450);
    return pick(RECAPS);
  },
  async describeImage(_url) {
    await delay(900);
    return pick(CAPTIONS);
  },
  async coachAdvice(_prompt) {
    await delay(600);
    return "Sit beside them in silence for ten minutes. The right sentence will arrive on its own.";
  },
};

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Enable / disable the demo provider as window.__AI_PROVIDER__.
 * Persisted to localStorage so it survives reloads.
 */
export function setAIDemoEnabled(on) {
  try {
    if (on) {
      window.__AI_PROVIDER__ = aiProviderMock;
      localStorage.setItem("nvvunenu.aiDemo", "1");
    } else {
      if (window.__AI_PROVIDER__ === aiProviderMock) delete window.__AI_PROVIDER__;
      localStorage.removeItem("nvvunenu.aiDemo");
    }
  } catch {}
}

export function isAIDemoEnabled() {
  try { return localStorage.getItem("nvvunenu.aiDemo") === "1"; }
  catch { return false; }
}

// Auto-restore on module import — so a refresh doesn't lose it.
if (isAIDemoEnabled()) setAIDemoEnabled(true);
