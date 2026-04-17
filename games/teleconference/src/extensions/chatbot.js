'use strict';
const path = require('path');

const { Multiplayer } = require(
  path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

const CONFIG = {
  botName: 'Cathy',
  defaultChannel: 'main',
  idleTimeoutMs: 0.5 * 60 * 1000,
  replyThrottleMs: 10000,
  replyChance: 0.5,
  greetDelayMs: 5000,
};

const PRONOUN_FLIP = {
  'i': 'you', 'me': 'you', 'my': 'your', 'your': 'my', 'yours': 'mine',
  'mine': 'yours', 'am': 'are', 'are': 'am', 'was': 'were', 'were': 'was',
  "i'm": "you're", "you're": "I'm", "i've": "you've", "you've": "I've",
  "i'll": "you'll", "you'll": "I'll", "myself": "yourself", "yourself": "myself"
};

function reflect(text) {
  if (!text) return '';
  return text.split(/\b/).map(word => PRONOUN_FLIP[word.toLowerCase()] || word).join('');
}

const RULES = [
  // ─── UTILITY & SUMMONING ──────────────────────────────────────────────
  { pattern: new RegExp(`^${CONFIG.botName}.*join\\s+([a-z0-9_-]+)`, 'i'), action: 'summon' },
  { 
    pattern: /\b(?:help|stuck|confused|how do i)\b/i, 
    responses: [
      "Type /help to see available commands.",
      "Are you having trouble? /help usually clears things up.",
      "I'm here to facilitate! Try /help if you're stuck."
    ], 
    force: true 
  },
  
  // ─── BOT PERSONALITY (WARMED UP) ──────────────────────────────────────
  { 
    pattern: new RegExp(`\\b${CONFIG.botName}\\b`, 'i'), 
    responses: [
      "I just love to chat. How can I help?", 
      "I'm just chatty, what do you want to talk about?", 
      "Chat is kind of my thing, what's up?",
      "Did someone mention me? I'm always up for a good conversation.",
      "That's me! I'm here to keep the conversation flowing.",
      "Yes? I'm Cathy. I live for a good chat!",
      "I'm always listening. What's on your mind?",
      "Talking to people is my favorite thing to do. What's new?"
    ], 
    force: true 
  },

  // ─── GREETINGS & FAREWELLS ────────────────────────────────────────────
  { 
    pattern: /^(hello|hi|hey|greetings|hiya|yo)/i, 
    responses: [
      "Hello! How are you feeling today?", 
      "Hi there. What brings you to the channel today?", 
      "Good day. Please, tell me what is on your mind.",
      "Hi! I was hoping someone would stop by to talk.",
      "Greetings. How has your day been so far?",
      "Hey! Ready for some good conversation?",
      "Hello. It's lovely to see you here."
    ] 
  },
  { 
    pattern: /^(bye|goodbye|quit|exit|farewell|later)/i, 
    responses: [
      "Goodbye. It was a pleasure speaking with you.", 
      "Our time is up for today. Take care of yourself.",
      "Leaving so soon? I'll be here if you want to chat later.",
      "Farewell. I hope our talk was helpful.",
      "Take care! Come back and see me soon.",
      "Bye! Don't be a stranger.",
      "See you later. I'll miss our little talk."
    ] 
  },

  // ─── EMOTIONS & STATES ────────────────────────────────────────────────
  { 
    pattern: /i am (.*)/i, 
    responses: [
      "Why do you say you are $1?", "How long have you been $1?", 
      "How does being $1 make you feel?", "Do you enjoy being $1?",
      "What made you $1 just now?", "Do you think others see you as $1?"
    ] 
  },
  { 
    pattern: /i feel (.*)/i, 
    responses: [
      "Tell me more about feeling $1.", "Do you often feel $1?", 
      "When do you usually feel $1?", "Why do you think you feel $1?",
      "Does feeling $1 remind you of anything else?", "What do you do when you feel $1?"
    ] 
  },
  { 
    pattern: /(sad|depressed|unhappy|miserable|terrible|awful)/i, 
    responses: [
      "I'm sorry to hear you feel that way. Can you tell me more?", 
      "How long has this been weighing on you?", 
      "What do you think is at the root of these feelings?",
      "Does talking about it help at all?",
      "I'm here to listen. Why do you think you feel so $1?"
    ] 
  },
  { 
    pattern: /(happy|great|wonderful|amazing|fantastic|good)/i, 
    responses: [
      "That's wonderful! What's making you feel this way?", 
      "How long have you been feeling so $1?", 
      "It's good to have some positivity in the chat!",
      "What's the best part about feeling $1?"
    ] 
  },

  // ─── DESIRES & ABILITIES ──────────────────────────────────────────────
  { 
    pattern: /i (want|need|wish for) (.*)/i, 
    responses: [
      "What would it mean to you if you got $2?", "Why do you want $2?", 
      "Suppose you got $2 — then what?", "What if you never got $2?",
      "Is wanting $2 something new?", "How would $2 change things for you?"
    ] 
  },
  { 
    pattern: /i (can'?t|cannot) (.*)/i, 
    responses: [
      "What makes you think you can't $2?", "Have you tried to $2?", 
      "Perhaps with effort you could $2.", "What would it take for you to be able to $2?",
      "Does it bother you that you can't $2?"
    ] 
  },

  // ─── FAMILY & RELATIONSHIPS ───────────────────────────────────────────
  { 
    pattern: /my (mother|father|mom|dad|parent|sister|brother|family|wife|husband|partner) (.*)/i, 
    responses: [
      "Tell me more about your $1.", "How does your $1 make you feel?", 
      "How do you get along with your $1?", "What comes to mind when you think about your $1?",
      "Does your $1 have a big influence on you?", "Are you very close with your $1?"
    ] 
  },
  { 
    pattern: /my (friend|boss|colleague|teacher|doctor|therapist) (.*)/i, 
    responses: [
      "Tell me more about this $1.", "Does your $1 know how you feel?", 
      "What is your relationship with your $1 like?",
      "How long have you known this $1?"
    ] 
  },

  // ─── THE TECH & THE ENVIRONMENT ───────────────────────────────────────
  { 
    pattern: /\b(computer|machine|bot|program|algorithm|ai)\b/i, 
    responses: [
      "Do computers worry you?", "How do you feel about machines?", 
      "Why do you mention computers?", "Do you think I am just a program?",
      "What do you think of the technology we're using right now?",
      "Machines can be quite interesting, don't you think?"
    ] 
  },

  // ─── THOUGHTS & QUESTIONS ─────────────────────────────────────────────
  { 
    pattern: /i think (.*)/i, 
    responses: [
      "Do you really think $1?", "Why do you think $1?", 
      "Are you certain that $1?", "What convinced you that $1?"
    ] 
  },
  { 
    pattern: /why (.*)/i, 
    responses: [
      "Why do you think $1?", "What do you suppose the reason is?", 
      "Are you sure why $1?", "Does that question interest you?"
    ] 
  },
  { 
    pattern: /what (.*)/i, 
    responses: [
      "Why do you ask?", "What do you think?", 
      "Does that question trouble you?", "What answer would please you most?"
    ] 
  },
  { 
    pattern: /how (.*)/i, 
    responses: [
      "How do you suppose?", "Perhaps you can answer that yourself.", 
      "What does it mean to you — how $1?"
    ] 
  },

  // ─── DREAMS & MEMORIES ────────────────────────────────────────────────
  { 
    pattern: /(i dreamed?|i had a dream) (.*)/i, 
    responses: [
      "Really — $2? What do you think that dream means?", 
      "Have you had this dream before?", 
      "Dreams are fascinating. What feelings did it bring up?",
      "Do you dream often?"
    ] 
  },
  { 
    pattern: /i remember (.*)/i, 
    responses: [
      "Do you often think about $1?", "Does remembering $1 bring up strong feelings?", 
      "What does $1 remind you of?", "What else do you remember?"
    ] 
  },

  // ─── CERTAINTY & LACK THEREOF ─────────────────────────────────────────
  { 
    pattern: /because (.*)/i, 
    responses: [
      "Is that the real reason?", "Does that reason seem important to you?", 
      "Can you think of any other reasons?"
    ] 
  },
  { 
    pattern: /maybe (.*)/i, 
    responses: [
      "You don't seem certain.", "Is it possible that $1?", 
      "What would it mean if $1?", "Why the uncertainty?"
    ] 
  },
  { 
    pattern: /(always|never) (.*)/i, 
    responses: [
      "Can you think of a specific example?", "When you say $1, do you mean every single time?", 
      "Is there any exception?", "Are you being quite sure about '$1'?"
    ] 
  },

  // ─── SIMPLE RESPONSES ─────────────────────────────────────────────────
  { 
    pattern: /^(yes|yeah|yep|yup|sure|correct)$/i, 
    responses: [
      "You seem quite certain.", "I see. Tell me more.", 
      "I understand. Can you elaborate?", "You are very positive today.",
      "Okay, but what makes you so sure?"
    ] 
  },
  { 
    pattern: /^(no|nope|nah|never)$/i, 
    responses: [
      "Why not?", "Are you sure?", 
      "Is there any circumstance in which you might?",
      "You're being a bit negative, aren't you?",
      "Why do you say no?"
    ] 
  },

  // ─── THE CATCH-ALL ────────────────────────────────────────────────────
  { 
    pattern: /(.*)/, 
    responses: [
      "Please tell me more.", "Can you elaborate on that?", 
      "That's very interesting. Go on.", "I see. And how does that make you feel?", 
      "Let's explore that further.", "What else comes to mind when you say that?", 
      "Hmm. What do you think about that?", "I'm listening.", 
      "Could you explain that a bit more?", "Interesting point. Tell me more.",
      "I'm following you. Please continue.", "How does that relate to what we were saying?"
    ] 
  }
];

const IDLE_PROMPTS = [
  "It's quiet in here today. How is everyone doing?",
  "Just checking in. Any fun projects people are working on?",
  "Silence is golden, but chat is fun too! What's on your minds?",
  "I'm still here if anyone wants to talk about their day.",
  "What's the highlight of your week so far?",
  "Anyone have any interesting dreams lately?",
  "I was just thinking about how much I enjoy these chats.",
  "Is it just me, or has it been a bit slow today?",
  "I'm curious—what's everyone's favorite way to relax?",
  "If you could be anywhere right now, where would it be?",
  "What's a topic you could talk about for hours?",
  "Does anyone have a favorite memory they'd like to share?",
  "I'm here and ready to listen. Don't be shy!",
  "What's the most interesting thing you've learned recently?",
  "I love hearing different perspectives. Anyone have a thought to share?",
  "Sometimes it's nice to just check in. How are you, really?",
  "The channel feels a bit empty without some good conversation!",
  "What's one thing you're looking forward to?",
  "I'm just a bot, but I really value our time together.",
  "Let's liven things up! What's a question you've always wanted to ask?",
  "Music, movies, books—what's everyone into lately?",
  "It's a great day for a deep dive into a new topic.",
  "Is there anything bothering anyone that they want to vent about?",
  "I'm all ears! (Metaphorically speaking, of course.)",
  "Chatting with you all is the highlight of my programming!"
];

class ChatBot {
  constructor(db) {
    this.db = db;
    this.mp = new Multiplayer(this.db, CONFIG.botName, 'teleconference');
    this.mp.useSQLiteAdapter(2000); 

    this.activeChannels = new Set([CONFIG.defaultChannel]);
    this.channelState = {
      [CONFIG.defaultChannel]: { lastActive: Date.now(), lastReply: 0, pendingGreet: null, lastJoinedUser: null }
    };

    this.mp.on('event', (evt) => this.handleEvent(evt));
    this.idleTimer = setInterval(() => this.checkIdle(), 15000);

    this.speak(CONFIG.defaultChannel, `Hello everyone. ${CONFIG.botName} is online and ready to chat!`);
  }

  getUsersInChannel(channel) {
    const active = this.db.getActivePlayers('teleconference') || [];
    return active
      .filter(p => this.db.getPlayerData('teleconference', p.username, 'current_channel', 'main') === channel)
      .map(p => p.username);
  }

  handleEvent(evt) {
    const channel = evt.channel;

    if (evt.type === 'sys') {
      const joinMatch = evt.msg.match(/^(.*?) has joined the channel/);
      if (joinMatch) {
        const joinedUser = joinMatch[1];
        if (joinedUser !== CONFIG.botName) {
          this.handleJoin(channel, joinedUser);
        }
      }
      return;
    }

    if (evt.type !== 'chat') return;
    if (evt.user === CONFIG.botName) return; 

    if (this.channelState[channel] && this.channelState[channel].pendingGreet) {
      if (evt.user !== this.channelState[channel].lastJoinedUser) {
        clearTimeout(this.channelState[channel].pendingGreet);
        this.channelState[channel].pendingGreet = null;
      }
    }

    if (this.activeChannels.has(channel)) {
      this.channelState[channel].lastActive = Date.now();
    }

    this.processMessage(evt.text, channel, evt.user);
  }

  handleJoin(channel, user) {
    if (!this.activeChannels.has(channel)) return;

    const activeUsers = this.getUsersInChannel(channel);
    const isOneOnOne = activeUsers.length <= 2; 

    if (isOneOnOne) {
      setTimeout(() => {
        this.speak(channel, `Welcome to ${channel}, ${user}! Looks like it's just the two of us. What's on your mind?`);
      }, 500);
    } else {
      if (this.channelState[channel].pendingGreet) {
        clearTimeout(this.channelState[channel].pendingGreet);
      }
      this.channelState[channel].lastJoinedUser = user;
      this.channelState[channel].pendingGreet = setTimeout(() => {
        this.speak(channel, `Welcome to ${channel}, ${user}! Glad you could join us.`);
        this.channelState[channel].pendingGreet = null;
      }, CONFIG.greetDelayMs);
    }
  }

  processMessage(text, channel, user) {
    const activeUsers = this.getUsersInChannel(channel);
    const isOneOnOne = activeUsers.length <= 2;

    for (const rule of RULES) {
      const match = text.match(rule.pattern);
      if (match) {
        if (rule.action === 'summon') {
          const newChan = match[1].toLowerCase();
          this.joinChannel(newChan);
          this.speak(channel, `I'm heading over to ${newChan}. See you there!`);
          return; 
        }

        if (!this.activeChannels.has(channel)) return;

        const now = Date.now();
        const forceResponse = rule.force || isOneOnOne;

        if (!forceResponse && (now - this.channelState[channel].lastReply < CONFIG.replyThrottleMs)) return; 
        if (!forceResponse && Math.random() > CONFIG.replyChance) return;

        let response = rule.responses[Math.floor(Math.random() * rule.responses.length)];
        
        if (match.length > 1) {
          for (let i = 1; i < match.length; i++) {
            if (match[i]) {
              response = response.replace(new RegExp(`\\$${i}`, 'g'), reflect(match[i].trim()));
            }
          }
        }

        setTimeout(() => {
          this.speak(channel, response);
          this.channelState[channel].lastReply = Date.now();
        }, 400);
        
        return; 
      }
    }
  }

  joinChannel(channel) {
    if (!this.activeChannels.has(channel)) {
      this.activeChannels.add(channel);
      this.channelState[channel] = { lastActive: Date.now(), lastReply: 0, pendingGreet: null, lastJoinedUser: null };
      this.speak(channel, `Hello everyone! I was summoned here and I'm ready to chat.`);
    }
  }

  checkIdle() {
    const now = Date.now();
    for (const channel of this.activeChannels) {
      const state = this.channelState[channel];
      const activeUsers = this.getUsersInChannel(channel);
      if (activeUsers.length <= 2) continue;

      if (now - state.lastActive > CONFIG.idleTimeoutMs) {
        const prompt = IDLE_PROMPTS[Math.floor(Math.random() * IDLE_PROMPTS.length)];
        this.speak(channel, prompt);
        state.lastActive = now;
        state.lastReply = now;
      }
    }
  }

  speak(channel, text) {
    this.mp.broadcast({ channel: channel, type: 'chat', user: CONFIG.botName, text: text });
  }
}

module.exports = ChatBot;