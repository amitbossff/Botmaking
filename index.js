// index.js - FINAL WORKING VERSION
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

// Your credentials
const TELEGRAM_TOKEN = '8603310729:AAFPtxjvuhTxhWWeHO70ApwyzLsmQVmZ2IM';
const MONGODB_URI = 'mongodb+srv://amittgofficial_db_user:Amit70615544@cluster0.vqfljne.mongodb.net/lifafa-bot?retryWrites=true&w=majority';
const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = '12345678901234567890123456789012';
const ENCRYPTION_IV = '1234567890123456';

// MongoDB Schema with tParam
const linkSchema = new mongoose.Schema({
    chatId: Number,
    link: String,
    lifafaId: String,
    referId: String,
    tParam: String,  // Added for t parameter
    status: { 
        type: String, 
        enum: ['pending', 'claimed', 'failed', 'expired'], 
        default: 'pending' 
    },
    amount: Number,
    claimTime: Date,
    error: String,
    createdAt: { type: Date, default: Date.now, expires: '24h' }
});

const userSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    phoneNumber: String,
    username: String,
    firstName: String,
    lastName: String,
    links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Link' }],
    claimSession: {
        active: { type: Boolean, default: false },
        startedAt: Date,
        currentIndex: { type: Number, default: 0 },
        totalLinks: { type: Number, default: 0 },
        claimedLinks: { type: Number, default: 0 },
        failedLinks: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 },
        selectedCount: { type: Number, default: 0 },
        unselectedCount: { type: Number, default: 0 }
    },
    stats: {
        totalClaims: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 },
        lastClaim: Date
    }
});

const Link = mongoose.model('Link', linkSchema);
const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI).then(() => console.log('✅ MongoDB Connected'));

// Initialize Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Encryption function
function encryptPayload(payload) {
    try {
        const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substr(0, 32);
        const iv = Buffer.from(ENCRYPTION_IV);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
        let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    } catch (e) {
        return '';
    }
}

// Main menu
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📤 Send Links', callback_data: 'send_links' }],
            [{ text: '📊 Status', callback_data: 'check_status' }],
            [{ text: '📞 Set Phone', callback_data: 'set_phone' }],
            [{ text: '🚀 Start Claim', callback_data: 'start_claim' }],
            [{ text: '📈 Stats', callback_data: 'statistics' }]
        ]
    }
};

// Progress bar
function createProgressBar(percent) {
    const filled = Math.round(percent / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ========== CLAIM FUNCTION - WORKING VERSION ==========
async function claimSingleLink(chatId, link) {
    try {
        const user = await User.findOne({ chatId });
        
        // Extract parameters
        let lifafaId = link.lifafaId || 'LF88DEB2E6';
        let tParam = link.tParam || '7412418424';
        
        // Prepare EXACT payload that works
        const payload = {
            action: "claimlifafa",
            lid: lifafaId,
            number: user.phoneNumber,
            accessCode: "",
            referid: "",
            selected: ""
        };
        
        console.log('📤 Sending payload:', payload);
        
        const encryptedPayload = encryptPayload(payload);
        
        const params = new URLSearchParams();
        params.append('data', encryptedPayload);
        
        // Send to handler
        const response = await axios.post('https://mahakalxlifafa.in/handler', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });
        
        console.log('📥 Response:', response.data);
        
        if (response.data && response.data.status === "success") {
            const isWin = response.data.claim_status !== "tried";
            const amount = isWin ? (response.data.perUser || 4) : 0;
            
            return {
                success: isWin,
                amount: amount,
                message: response.data.message || (isWin ? '✅ Success' : '❌ Already tried'),
                data: response.data
            };
        }
        
        return { success: false, error: 'Invalid response', amount: 0 };
        
    } catch (error) {
        console.error('Claim error:', error.message);
        return { success: false, error: error.message, amount: 0 };
    }
}

// Save link with t parameter
async function saveLink(chatId, link) {
    try {
        let lifafaId = 'default';
        let tParam = '';
        
        try {
            const url = new URL(link);
            lifafaId = url.searchParams.get('i') || 'default';
            tParam = url.searchParams.get('t') || '';
        } catch (e) {
            const match = link.match(/[?&]i=([^&]+)/);
            if (match) lifafaId = match[1];
            const tMatch = link.match(/[?&]t=([^&]+)/);
            if (tMatch) tParam = tMatch[1];
        }
        
        const existingLink = await Link.findOne({ chatId, link });
        if (existingLink) {
            bot.sendMessage(chatId, '⚠️ Link already exists!');
            return;
        }
        
        const newLink = new Link({
            chatId,
            link,
            lifafaId,
            tParam,
            status: 'pending'
        });
        
        await newLink.save();
        
        await User.findOneAndUpdate(
            { chatId },
            { $push: { links: newLink._id } },
            { upsert: true }
        );
        
        const total = await Link.countDocuments({ chatId });
        bot.sendMessage(chatId, `✅ Link saved! Total: ${total}`, mainMenu);
        
    } catch (error) {
        bot.sendMessage(chatId, '❌ Error saving link');
    }
}

// Save phone number
async function savePhoneNumber(chatId, phone) {
    await User.findOneAndUpdate({ chatId }, { phoneNumber: phone }, { upsert: true });
    bot.sendMessage(chatId, `✅ Phone saved: ${phone}`, mainMenu);
}

// Show status
async function showStatus(chatId) {
    const links = await Link.find({ chatId });
    const user = await User.findOne({ chatId });
    
    if (links.length === 0) {
        bot.sendMessage(chatId, '📊 No links yet', mainMenu);
        return;
    }
    
    const pending = links.filter(l => l.status === 'pending').length;
    const claimed = links.filter(l => l.status === 'claimed').length;
    const failed = links.filter(l => l.status === 'failed').length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    
    const msg = `📊 *Status*\n\n` +
        `Total: ${links.length}\n` +
        `⏳ Pending: ${pending}\n` +
        `✅ Claimed: ${claimed}\n` +
        `❌ Failed: ${failed}\n` +
        `💰 Amount: ₹${totalAmount}\n` +
        `📞 Phone: ${user?.phoneNumber || 'Not set'}`;
    
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...mainMenu });
}

// Start claim process
async function startClaimProcess(chatId) {
    const user = await User.findOne({ chatId });
    const links = await Link.find({ chatId, status: 'pending' });
    
    if (!user?.phoneNumber) {
        bot.sendMessage(chatId, '❌ Set phone number first', mainMenu);
        return;
    }
    
    if (links.length === 0) {
        bot.sendMessage(chatId, '❌ No pending links', mainMenu);
        return;
    }
    
    await User.findOneAndUpdate(
        { chatId },
        {
            'claimSession.active': true,
            'claimSession.startedAt': new Date(),
            'claimSession.currentIndex': 0,
            'claimSession.totalLinks': links.length
        }
    );
    
    bot.sendMessage(chatId, `🚀 Starting claim for ${links.length} links...`);
    processNextLink(chatId, 0);
}

// Process next link
async function processNextLink(chatId, index) {
    const user = await User.findOne({ chatId });
    if (!user?.claimSession?.active) return;
    
    const links = await Link.find({ chatId, status: 'pending' });
    if (index >= links.length) {
        await User.findOneAndUpdate({ chatId }, { 'claimSession.active': false });
        const stats = await getFinalStats(chatId);
        bot.sendMessage(chatId, `✅ *Complete!*\n${stats}`, { parse_mode: 'Markdown', ...mainMenu });
        return;
    }
    
    const link = links[index];
    
    // Show progress
    const progress = createProgressBar((index / links.length) * 100);
    bot.sendMessage(chatId, 
        `🔄 *${index+1}/${links.length}*\n${progress}\nTrying: ${link.lifafaId}`
    );
    
    // Claim
    const result = await claimSingleLink(chatId, link);
    
    if (result.success) {
        await Link.findByIdAndUpdate(link._id, {
            status: 'claimed',
            amount: result.amount,
            claimTime: new Date()
        });
        
        await User.findOneAndUpdate(
            { chatId },
            {
                $inc: {
                    'claimSession.claimedLinks': 1,
                    'claimSession.totalAmount': result.amount,
                    'stats.totalClaims': 1,
                    'stats.totalAmount': result.amount
                }
            }
        );
        
        if (result.amount > 0) {
            await User.findOneAndUpdate({ chatId }, { $inc: { 'claimSession.selectedCount': 1 } });
        }
        
        bot.sendMessage(chatId, `✅ Won: ₹${result.amount}`);
    } else {
        await Link.findByIdAndUpdate(link._id, {
            status: 'failed',
            error: result.error,
            claimTime: new Date()
        });
        
        await User.findOneAndUpdate(
            { chatId },
            {
                $inc: {
                    'claimSession.failedLinks': 1,
                    'stats.totalClaims': 1
                }
            }
        );
        
        bot.sendMessage(chatId, `❌ Failed: ${result.error}`);
    }
    
    // Next after 30 seconds
    setTimeout(() => processNextLink(chatId, index + 1), 30000);
}

// Get final stats
async function getFinalStats(chatId) {
    const links = await Link.find({ chatId });
    const claimed = links.filter(l => l.status === 'claimed').length;
    const failed = links.filter(l => l.status === 'failed').length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    const selected = links.filter(l => l.amount > 0).length;
    
    return `📊 *Results*\n\n` +
        `Total: ${links.length}\n` +
        `✅ Claimed: ${claimed}\n` +
        `❌ Failed: ${failed}\n` +
        `🎯 Selected: ${selected}\n` +
        `💰 Amount: ₹${totalAmount}`;
}

// ========== BOT COMMANDS ==========
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate(
        { chatId },
        { username: msg.from.username },
        { upsert: true }
    );
    
    bot.sendMessage(chatId,
        `🎁 *Lifafa Bot*\n\n` +
        `1️⃣ Send links\n` +
        `2️⃣ Set phone number\n` +
        `3️⃣ Start claim`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.on('callback_query', async (cb) => {
    const chatId = cb.message.chat.id;
    bot.answerCallbackQuery(cb.id);
    
    switch(cb.data) {
        case 'send_links':
            bot.sendMessage(chatId, '📤 Send your lifafa links');
            break;
        case 'check_status':
            await showStatus(chatId);
            break;
        case 'set_phone':
            bot.sendMessage(chatId, '📞 Send 10-digit phone number');
            break;
        case 'start_claim':
            await startClaimProcess(chatId);
            break;
        case 'statistics':
            const stats = await getFinalStats(chatId);
            bot.sendMessage(chatId, stats, { parse_mode: 'Markdown', ...mainMenu });
            break;
    }
});

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    
    if (/^\d{10}$/.test(text)) {
        await savePhoneNumber(chatId, text);
    } else if (text.includes('lifafa') || text.includes('http')) {
        await saveLink(chatId, text);
    } else {
        bot.sendMessage(chatId, '❌ Send link or phone number');
    }
});

// Web server
app.get('/', (req, res) => {
    res.send('🤖 Lifafa Bot Running');
});

app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});

console.log('🤖 Bot Started - FINAL WORKING VERSION');
