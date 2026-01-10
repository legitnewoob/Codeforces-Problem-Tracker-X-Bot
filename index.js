// index.js
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');

const app = express();
app.use(express.json());

// Configuration from environment variables
const CONFIG = {
  CF_HANDLE: process.env.CF_HANDLE,
  X_API_KEY: process.env.X_API_KEY,
  X_API_SECRET: process.env.X_API_SECRET,
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  X_ACCESS_SECRET: process.env.X_ACCESS_SECRET,
  PORT: process.env.PORT || 3000,
  TIMEZONE: 'Asia/Kolkata' // IST timezone
};

// ============================================
// EDITABLE PRAISE AND INSULT CONFIGURATION
// ============================================

// Tweet character limit (280 for free accounts, 4000 for X Premium)
const TWEET_CHAR_LIMIT = 280;

// Praise messages based on performance (checked from top to bottom)
const PRAISE_CATEGORIES = [
  {
    minProblems: 10,
    minMedianRating: 1600,
    message: "🔥 ABSOLUTE LEGEND! 10+ problems with median 1600+! You're on fire! 🚀"
  },
  {
    minProblems: 8,
    minMedianRating: 1400,
    message: "⭐ Outstanding work! 8+ problems with solid ratings! Keep this momentum! 💪"
  },
  {
    minProblems: 5,
    minMedianRating: 1200,
    message: "🎯 Great grind! 5+ problems solved, you're building strong habits! 💡"
  },
  {
    minProblems: 5,
    minMedianRating: 0,
    message: "✅ Nice! 5+ problems solved. Consistency is key! 📈"
  },
  {
    minProblems: 3,
    minMedianRating: 1400,
    message: "👏 Quality over quantity! 3+ tough problems conquered! 🧠"
  },
  {
    minProblems: 3,
    minMedianRating: 0,
    message: "👍 Solid work! 3 problems down. Keep pushing! 💻"
  },
  {
    minProblems: 1,
    minMedianRating: 0,
    message: "✨ Every problem counts! Good start, let's do more tomorrow! 🌱"
  }
];

// Insult messages for when 0 problems are solved (one random message is picked)
const INSULT_MESSAGES = [
  "Zero problems solved? Even a potato could've at least tried one. 🥔",
  "Congratulations on achieving absolutely nothing today. Your keyboard must be proud of its vacation. ⌨️",
  "0 problems solved. The only thing you're solving is how to waste 24 hours. ⏰",
  "Your competitive programming career is looking as empty as your problem count today. 📉",
  "Even Hello World wouldn't want to be solved by you today. Pathetic. 💀",
  "24 hours and 0 problems? You could've at least accidentally solved one. 🤡",
  "Your consistency is impressive - consistently disappointing. 0 problems again. 😴"
];

// ============================================

// Helper function to get current time in IST
function getISTTime() {
  return new Date().toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE });
}

// Validate required environment variables
function validateConfig() {
  const required = ['CF_HANDLE', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
  const missing = required.filter(key => !CONFIG[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file');
    process.exit(1);
  }
}

// Fetch user submissions from Codeforces API
async function fetchRecentSubmissions(handle) {
  try {
    const response = await axios.get(
      `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=100`
    );
    
    if (response.data.status !== 'OK') {
      throw new Error('Failed to fetch submissions');
    }
    
    return response.data.result;
  } catch (error) {
    console.error('Error fetching submissions:', error.message);
    return [];
  }
}

// Filter submissions from last 24 hours
function filterLast24Hours(submissions) {
  const now = Math.floor(Date.now() / 1000);
  const yesterday = now - 24 * 60 * 60;
  
  const solvedProblems = new Map();
  
  submissions.forEach(sub => {
    if (sub.creationTimeSeconds >= yesterday && sub.verdict === 'OK') {
      const problemKey = `${sub.problem.contestId}${sub.problem.index}`;
      if (!solvedProblems.has(problemKey)) {
        solvedProblems.set(problemKey, {
          name: sub.problem.name,
          rating: sub.problem.rating || 0,
          contestId: sub.problem.contestId,
          index: sub.problem.index
        });
      }
    }
  });
  
  return Array.from(solvedProblems.values());
}

// Calculate median rating
function getMedianRating(problems) {
  if (problems.length === 0) return 0;
  
  const ratings = problems.map(p => p.rating).filter(r => r > 0).sort((a, b) => a - b);
  if (ratings.length === 0) return 0;
  
  const mid = Math.floor(ratings.length / 2);
  return ratings.length % 2 === 0 
    ? (ratings[mid - 1] + ratings[mid]) / 2 
    : ratings[mid];
}

// Truncate message to fit within character limit
function truncateToLimit(message, limit) {
  if (message.length <= limit) {
    return message;
  }
  
  // Truncate and add ellipsis
  return message.substring(0, limit - 3) + '...';
}

// Generate message based on performance
function generateMessage(problems) {
  const count = problems.length;
  
  // If no problems solved, return a random insult with header
  if (count === 0) {
    const insult = INSULT_MESSAGES[Math.floor(Math.random() * INSULT_MESSAGES.length)];
    const message = `📊 CF Daily Report:\n\n${insult}`;
    return truncateToLimit(message, TWEET_CHAR_LIMIT);
  }
  
  const median = getMedianRating(problems);
  
  // Find the first matching praise category
  let praise = '';
  for (const category of PRAISE_CATEGORIES) {
    if (count >= category.minProblems && median >= category.minMedianRating) {
      praise = category.message;
      break;
    }
  }
  
  // Build the message header
  let header = `📊 CF Daily Report:\n\n${praise}\n\n`;
  header += `✅ Problems: ${count}`;
  
  // Only show median rating if at least one problem has a rating
  if (median > 0) {
    header += ` | 📈 Median: ${Math.round(median)}`;
  }
  header += '\n\n';
  
  const footer = '\n#Codeforces #CP #100DaysOfCode';
  
  // Calculate available space for problems list
  const headerFooterLength = header.length + footer.length;
  const availableSpace = TWEET_CHAR_LIMIT - headerFooterLength - 10; // 10 char buffer
  
  // Build problems list within available space
  let problemsList = '📝 Problems:\n';
  let currentLength = problemsList.length;
  let problemsAdded = 0;
  
  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    const ratingStr = p.rating ? ` [${p.rating}]` : '';
    const problemLine = `${i + 1}. ${p.name}${ratingStr}\n`;
    
    if (currentLength + problemLine.length <= availableSpace) {
      problemsList += problemLine;
      currentLength += problemLine.length;
      problemsAdded++;
    } else {
      // Can't fit more problems, add indicator
      const remaining = problems.length - problemsAdded;
      if (remaining > 0) {
        problemsList += `...and ${remaining} more\n`;
      }
      break;
    }
  }
  
  const finalMessage = header + problemsList + footer;
  
  // Final safety check
  if (finalMessage.length > TWEET_CHAR_LIMIT) {
    console.warn(`⚠️  Message exceeds limit (${finalMessage.length} chars), truncating...`);
    return truncateToLimit(finalMessage, TWEET_CHAR_LIMIT);
  }
  
  console.log(`✅ Message length: ${finalMessage.length}/${TWEET_CHAR_LIMIT} characters`);
  return finalMessage;
}

// Post to X (Twitter)
async function postToX(message) {
  try {
    // Try OAuth 1.0a first (original method)
    console.log('🔐 Attempting OAuth 1.0a authentication...');
    const client = new TwitterApi({
      appKey: CONFIG.X_API_KEY,
      appSecret: CONFIG.X_API_SECRET,
      accessToken: CONFIG.X_ACCESS_TOKEN,
      accessSecret: CONFIG.X_ACCESS_SECRET,
    });
    
    // Test authentication
    try {
      const me = await client.v2.me();
      console.log(`✅ Authenticated as: @${me.data.username}`);
    } catch (authError) {
      console.error('❌ OAuth 1.0a authentication failed');
      console.error('Error:', authError.message);
      throw authError;
    }
    
    // Try to post the tweet
    console.log('📤 Posting tweet with OAuth 1.0a...');
    const result = await client.v2.tweet(message);
    console.log('✅ Successfully posted to X!');
    console.log(`Tweet ID: ${result.data.id}`);
    console.log(`Tweet URL: https://twitter.com/i/web/status/${result.data.id}`);
    return result;
  } catch (error) {
    console.error('❌ Error posting to X:', error.message);
    if (error.code) console.error('Error code:', error.code);
    if (error.data) {
      console.error('Error data:', JSON.stringify(error.data, null, 2));
      
      // Check if it's a permissions issue
      if (error.code === 403) {
        console.error('\n⚠️  403 Forbidden Error - Possible causes:');
        console.error('1. Your X account might need "Elevated Access" for API posting');
        console.error('2. App permissions might not be fully propagated (wait 15 minutes after changing)');
        console.error('3. Your X account might have restrictions');
        console.error('\n📝 Apply for Elevated Access at:');
        console.error('   https://developer.twitter.com/en/portal/petition/essential/basic-info');
      }
    }
    throw error;
  }
}

// Main daily task
async function dailyTask() {
  console.log('🔄 Running daily Codeforces check...');
  console.log(`Time (IST): ${getISTTime()}`);
  console.log(`Time (UTC): ${new Date().toISOString()}`);
  
  try {
    const submissions = await fetchRecentSubmissions(CONFIG.CF_HANDLE);
    const recentProblems = filterLast24Hours(submissions);
    const message = generateMessage(recentProblems);
    
    console.log('\n📝 Generated message:');
    console.log(message);
    console.log('\n');
    
    await postToX(message);
    
    console.log('✅ Daily task completed!\n');
  } catch (error) {
    console.error('❌ Error in daily task:', error.message);
  }
}

// Schedule daily task at midnight IST (00:00 IST)
// Using direct IST time: 0 0 * * * means midnight in Asia/Kolkata timezone
cron.schedule('0 0 * * *', () => {
  console.log('⏰ Midnight IST reached! Running scheduled task...');
  dailyTask();
}, {
  timezone: "Asia/Kolkata"
});

console.log('📅 Cron job scheduled for: 00:00 IST (midnight)');

// Manual trigger endpoint
app.post('/trigger', async (req, res) => {
  try {
    await dailyTask();
    res.json({ success: true, message: 'Task triggered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'running', 
    time: new Date().toISOString(),
    timeIST: getISTTime(),
    cfHandle: CONFIG.CF_HANDLE,
    timezone: CONFIG.TIMEZONE
  });
});

// Start server
validateConfig();

app.listen(CONFIG.PORT, () => {
  console.log('🚀 Codeforces Tracker Bot Started!');
  console.log(`📡 Server running on port ${CONFIG.PORT}`);
  console.log(`👤 Tracking handle: ${CONFIG.CF_HANDLE}`);
  console.log(`🌏 Timezone: ${CONFIG.TIMEZONE}`);
  console.log(`📅 Scheduled to post daily at midnight IST (00:00 IST)`);
  console.log(`🕐 Current IST time: ${getISTTime()}`);
  console.log(`🕐 Current UTC time: ${new Date().toISOString()}`);
  console.log(`🔧 Manual trigger: POST http://localhost:${CONFIG.PORT}/trigger`);
  console.log(`💚 Health check: GET http://localhost:${CONFIG.PORT}/health\n`);
});

module.exports = app;