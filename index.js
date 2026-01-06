// index.js
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');

const app = express();
app.use(express.json());

// ============================================
// CONFIG
// ============================================

const CONFIG = {
  CF_HANDLE: process.env.CF_HANDLE,
  X_API_KEY: process.env.X_API_KEY,
  X_API_SECRET: process.env.X_API_SECRET,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_ACCESS_SECRET: process.env.X_ACCESS_SECRET,
  PORT: process.env.PORT || 3000
};

// X limits
const X_CHAR_LIMIT = 280;
const FULL_MODE_MAX_PROBLEMS = 5;
const COMPACT_MODE_MAX_PROBLEMS = 10;

// ============================================
// PRAISE / INSULT CONFIG
// ============================================

const PRAISE_CATEGORIES = [
  { minProblems: 15, minMedianRating: 1800, message: "🧠 MONSTER SESSION. 15+ problems, 1800+ median. Absolutely cracked. 👑" },
  { minProblems: 12, minMedianRating: 1700, message: "🚀 Elite grind detected. 12+ tough problems. Dangerous territory. 💣" },
  { minProblems: 10, minMedianRating: 1600, message: "🔥 ABSOLUTE LEGEND. 10+ problems at 1600+. On fire. 🚀" },
  { minProblems: 8, minMedianRating: 1500, message: "⚔️ Strong performance. 8+ serious problems. Respect. 🫡" },
  { minProblems: 6, minMedianRating: 1300, message: "📈 Consistency + quality. Real progress today. 👏" },
  { minProblems: 5, minMedianRating: 1200, message: "🎯 Great grind. Strong habits forming. 💡" },
  { minProblems: 4, minMedianRating: 1000, message: "💪 Solid work. Keep the momentum going! 🚴" },
  { minProblems: 3, minMedianRating: 0, message: "👍 Decent effort. Show up again tomorrow. 💻" },
  { minProblems: 2, minMedianRating: 0, message: "🙂 Not bad. Two problems solved is better than one. Keep going! 🔥" },
  { minProblems: 1, minMedianRating: 0, message: "✨ You showed up. One problem > zero excuses. 🌱" }
];

const INSULT_MESSAGES = [
  "Zero problems solved. Even your keyboard clocked out early. ⌨️",
  "0 problems today. Competitive procrastination unlocked. 🤡",
  "No submissions. Training arc postponed indefinitely. 😴",
  "Another day, zero problems. Consistency… but not the good kind. 📉"
];

// ============================================
// UTILITIES
// ============================================

function validateConfig() {
  const required = ['CF_HANDLE', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
  const missing = required.filter(k => !CONFIG[k]);
  if (missing.length) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function charCount(text) {
  return [...text].length; // emoji-safe
}

// ============================================
// CODEFORCES LOGIC
// ============================================

async function fetchRecentSubmissions(handle) {
  try {
    const res = await axios.get(
      `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=100`
    );
    return res.data.status === 'OK' ? res.data.result : [];
  } catch {
    return [];
  }
}

function filterLast24Hours(submissions) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 24 * 60 * 60;
  const map = new Map();

  submissions.forEach(sub => {
    if (sub.creationTimeSeconds >= cutoff && sub.verdict === 'OK') {
      const key = `${sub.problem.contestId}${sub.problem.index}`;
      if (!map.has(key)) {
        map.set(key, {
          name: sub.problem.name,
          rating: sub.problem.rating || 0
        });
      }
    }
  });

  return [...map.values()];
}

function getMedianRating(problems) {
  const ratings = problems.map(p => p.rating).filter(Boolean).sort((a, b) => a - b);
  if (!ratings.length) return 0;
  const mid = Math.floor(ratings.length / 2);
  return ratings.length % 2 ? ratings[mid] : (ratings[mid - 1] + ratings[mid]) / 2;
}

// ============================================
// MESSAGE BUILDERS
// ============================================

function buildFullMessage(praise, problems, median) {
  let msg = `📊 Codeforces Daily Report\n\n${praise}\n\n`;
  msg += `✅ Solved: ${problems.length}\n`;
  if (median > 0) msg += `📈 Median: ${Math.round(median)}\n`;
  msg += `\n📝 Problems:\n`;
  problems.forEach((p, i) => {
    msg += `${i + 1}. ${p.name}${p.rating ? ` [${p.rating}]` : ''}\n`;
  });
  msg += `\n#Codeforces`;
  return msg;
}

function buildCompactMessage(praise, problems, median) {
  let msg = `📊 CF Daily\n\n${praise}\n\n`;
  msg += `✅ Solved: ${problems.length}`;
  if (median > 0) msg += ` | 📈 ${Math.round(median)}`;
  msg += `\n\n🧠 Highlights:\n`;
  problems.slice(0, 3).forEach((p, i) => {
    msg += `${i + 1}. ${p.name}${p.rating ? ` [${p.rating}]` : ''}\n`;
  });
  msg += `(+${problems.length - 3} more)\n#Codeforces`;
  return msg;
}

function buildBriefMessage(praise, problems, median) {
  let msg = `📊 CF Daily\n\n${praise}\n\n`;
  msg += `✅ Solved: ${problems.length}`;
  if (median > 0) msg += ` | 📈 ${Math.round(median)}`;
  msg += `\n\nPure grind. No details today. 🫡\n#Codeforces`;
  return msg;
}

// ============================================
// MESSAGE GENERATOR (SMART MODE)
// ============================================

function generateMessage(problems) {
  const count = problems.length;

  if (count === 0) {
    return INSULT_MESSAGES[Math.floor(Math.random() * INSULT_MESSAGES.length)];
  }

  const median = getMedianRating(problems);

  let praise = '';
  for (const p of PRAISE_CATEGORIES) {
    if (count >= p.minProblems && median >= (p.minMedianRating || 0)) {
      praise = p.message;
      break;
    }
  }

  let message;
  if (count <= FULL_MODE_MAX_PROBLEMS) {
    message = buildFullMessage(praise, problems, median);
  } else if (count <= COMPACT_MODE_MAX_PROBLEMS) {
    message = buildCompactMessage(praise, problems, median);
  } else {
    message = buildBriefMessage(praise, problems, median);
  }

  if (charCount(message) > X_CHAR_LIMIT) {
    message = buildBriefMessage(praise, problems, median);
  }

  return message;
}

// ============================================
// X POSTING
// ============================================

async function postToX(message) {
  const client = new TwitterApi({
    appKey: CONFIG.X_API_KEY,
    appSecret: CONFIG.X_API_SECRET,
    accessToken: CONFIG.X_ACCESS_TOKEN,
    accessSecret: CONFIG.X_ACCESS_SECRET
  });

  const me = await client.v2.me();
  console.log(`✅ Authenticated as @${me.data.username}`);

  const tweet = await client.v2.tweet(message);
  console.log(`✅ Tweet posted: ${tweet.data.id}`);
}

// ============================================
// DAILY TASK
// ============================================

async function dailyTask() {
  console.log('🔄 Running daily task...');
  const submissions = await fetchRecentSubmissions(CONFIG.CF_HANDLE);
  const problems = filterLast24Hours(submissions);
  const message = generateMessage(problems);

  console.log('\n📝 Tweet:\n', message);
  console.log(`📏 Length: ${charCount(message)}`);

  await postToX(message);
}

// ============================================
// CRON + SERVER
// ============================================

cron.schedule('0 0 * * *', dailyTask);

app.post('/trigger', async (_, res) => {
  await dailyTask();
  res.json({ ok: true });
});

app.get('/health', (_, res) => {
  res.json({ status: 'running', handle: CONFIG.CF_HANDLE });
});

validateConfig();

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server running on ${CONFIG.PORT}`);
});