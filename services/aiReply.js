// =====================================================================
// services/aiReply.js — local, on-device smart-reply generator.
// No external API. Uses pattern matching + short conversation memory.
//
// Pluggable upgrade: if window.__AI_PROVIDER__.suggestReplies(messages, count)
// is defined, suggestReplies() will await it through aiCall (which absorbs
// errors) and fall back to the local heuristic when the provider returns
// nothing or fails.
// =====================================================================

import { aiCall } from "./aiProvider.js";

const chatMemory = new Map(); // chatId -> [{ sender, text, time }]
const MEMORY_LIMIT = 20;

/** Record a message into the conversation memory for a chat. */
export function rememberMessage(chatId, message) {
  if (!chatId || !message) return;
  let arr = chatMemory.get(chatId) || [];
  arr.push({
    sender: message.sender,
    text:   message.text || "",
    time:   message.time || Date.now()
  });
  if (arr.length > MEMORY_LIMIT) arr = arr.slice(-MEMORY_LIMIT);
  chatMemory.set(chatId, arr);
}

export function getMemory(chatId) { return chatMemory.get(chatId) || []; }

export function clearMemory(chatId) {
  if (chatId) chatMemory.delete(chatId);
  else chatMemory.clear();
}

/**
 * Generate up to 4 reply suggestions for a chat.
 * Tailored to the LAST incoming message + the broader convo context.
 */
export async function suggestReplies(chatId, myUid) {
  const memory = getMemory(chatId);
  if (!memory.length) return greetings();

  // Try a real provider first if one is plugged in.
  const out = await aiCall("suggestReplies", memory, 4);
  if (Array.isArray(out) && out.length) return out.slice(0, 4);

  return localSuggestions(memory, myUid);
}

function localSuggestions(memory, myUid) {
  // Find the last message NOT from me.
  let lastIncoming = null;
  for (let i = memory.length - 1; i >= 0; i--) {
    if (memory[i].sender !== myUid) { lastIncoming = memory[i]; break; }
  }
  if (!lastIncoming) return greetings();

  const text  = (lastIncoming.text || "").trim();
  if (!text) return greetings();
  const lower = text.toLowerCase();

  const isQuestion   = /\?\s*$/.test(text) ||
    /^(what|why|how|when|where|who|which|do|did|does|is|are|was|were|will|would|could|should|can|may|have|has|had)\b/i.test(text);
  const isGreeting   = /\b(hi|hello|hey|yo|morning|mornin|evening|afternoon|night|gm|gn|good morning|good night)\b/i.test(lower);
  const hasLove      = /\b(love|miss|babe|baby|darling|sweetheart|jaan|cutie|my love|muah|mwah)\b/i.test(lower) || /❤|💕|💖|💗|💓|💘|😘|🥰/.test(text);
  const hasSad       = /\b(sad|upset|tired|exhausted|lonely|cry|crying|hurt|angry|mad|stressed|anxious)\b/i.test(lower) || /😭|😢|😞|😔|🥺|😩/.test(text);
  const hasHappy     = /\b(happy|excited|amazing|yay|great|wonderful|fantastic|awesome)\b/i.test(lower) || /😄|😊|🤩|🥳/.test(text);
  const isPlan       = /\b(meet|dinner|lunch|coffee|movie|date|tomorrow|tonight|weekend|party|go out|hang)\b/i.test(lower);
  const isThanks     = /\b(thanks|thank you|ty|thx)\b/i.test(lower);
  const isApology    = /\b(sorry|apologi|my bad|forgive)\b/i.test(lower);
  const isYesNo      = /^(yes|yeah|yep|yup|no|nope|nah|sure|okay|ok)\b/i.test(lower);
  const isCompliment = /\b(beautiful|handsome|pretty|cute|gorgeous|smart|sweet|amazing)\b/i.test(lower);
  const isGoodbye    = /\b(bye|goodbye|see you|ttyl|later|gtg|g2g)\b/i.test(lower);
  const hasFood      = /\b(hungry|eat|food|dinner|lunch|breakfast|snack|pizza|coffee)\b/i.test(lower);
  const askAboutMe   = /\b(you|yours|your)\b/i.test(lower) && isQuestion;

  const out = [];

  if (isApology)            out.push("It's okay, don't worry about it 💕", "No need to apologise, really.", "We're good ❤️");
  else if (isThanks)        out.push("Anytime 💕", "You're welcome!", "Always for you ❤️");
  else if (isGoodbye)       out.push("Talk soon! ❤️", "Miss you already 🥺", "Bye bye 💕");
  else if (hasSad)          out.push("I'm here for you ❤️", "Tell me what happened.", "Sending you a big hug 🤗", "You're not alone, I love you 💕");
  else if (hasHappy)        out.push("That's amazing! 🥳", "So happy for you ❤️", "Tell me more!");
  else if (hasLove)         out.push("I love you more 💕", "You have my heart ❤️", "Miss you too 🥰", "Mwah 😘");
  else if (isCompliment)    out.push("Aww, stop it 🥰", "You're sweeter ❤️", "Thank you my love 💕");
  else if (isPlan)          out.push("Yes! Let's do it 💕", "What time works for you?", "Sounds perfect ❤️", "I'd love that!");
  else if (hasFood)         out.push("What are you craving?", "Let's order something 🍕", "I was thinking the same!");
  else if (isGreeting) {
    if (/night|gn/i.test(lower))         out.push("Good night my love 🌙", "Sweet dreams ❤️", "Night night 😘");
    else if (/morning|gm/i.test(lower))  out.push("Good morning! ☀️", "Morning sunshine 💕", "Hope you slept well ❤️");
    else                                  out.push("Hey! 💕", "Hi love ❤️", "Hello you!");
  }
  else if (askAboutMe)      out.push("Tell me yours first 😊", "Hmm, let me think…", "Good question!");
  else if (isYesNo) {
    if (/^(yes|yeah|yep|yup|sure|okay|ok)/i.test(lower)) out.push("Perfect! ❤️", "Awesome 💕", "Great!");
    else                                                  out.push("Aww, okay 🥺", "Another time then?", "No worries ❤️");
  }
  else if (isQuestion)      out.push("Hmm, good question 🤔", "Let me think…", "I'll get back to you!", "What do you think?");
  else                      out.push("Got it 💕", "Tell me more", "Haha okay ❤️", "Sounds good!");

  return [...new Set(out)].slice(0, 4);
}

function greetings() { return ["Hey 💕", "Hi love ❤️", "Miss you 🥺", "What's up?"]; }

/** Returns true if the partner sent the last message > 2 minutes ago. */
export function shouldNudge(chatId, myUid) {
  const memory = getMemory(chatId);
  if (memory.length < 2) return false;
  const last = memory[memory.length - 1];
  if (last.sender === myUid) return false;
  const t = typeof last.time === "number" ? last.time : new Date(last.time).getTime();
  return Date.now() - t > 2 * 60 * 1000;
}
