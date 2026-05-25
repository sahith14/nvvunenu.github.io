// =====================================================================
// utils/skeleton.js — shimmer placeholder rows shown while data loads.
// Pair with /styles/skeleton.css.
//
// Usage:
//   import { skeletonList } from "../utils/skeleton.js";
//   container.innerHTML = skeletonList(6, "dm");
// =====================================================================

const VARIANTS = {
  dm:     `<div class="sk-row"><div class="sk-circle"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w40"></div></div></div>`,
  msg:    `<div class="sk-msg"><div class="sk-bubble"></div></div>`,
  card:   `<div class="sk-card"><div class="sk-line w80"></div><div class="sk-line w60"></div><div class="sk-box"></div></div>`,
  memory: `<div class="sk-memory"><div class="sk-line w40"></div><div class="sk-box"></div><div class="sk-line w80"></div></div>`,
  feed:   `<div class="sk-card"><div class="sk-row"><div class="sk-circle"></div><div class="sk-line w40"></div></div><div class="sk-box"></div><div class="sk-line w60"></div></div>`,
  list:   `<div class="sk-row"><div class="sk-square"></div><div class="sk-lines"><div class="sk-line w70"></div><div class="sk-line w30"></div></div></div>`,
  game:   `<div class="sk-card"><div class="sk-line w50"></div><div class="sk-grid"></div></div>`
};

export function skeletonList(count = 6, variant = "dm") {
  const row = VARIANTS[variant] || `<div class="sk-line w80"></div>`;
  return `<div class="skeleton" role="status" aria-label="Loading">${row.repeat(count)}</div>`;
}

export function skeletonOne(variant = "card") {
  return skeletonList(1, variant);
}
