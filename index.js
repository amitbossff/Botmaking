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

// MongoDB Schema
const linkSchema = new mongoose.Schema({
    chatId: Number,
    link: String,
    lifafaId: String,
    status: { type: String, default: 'pending' },
    amount: Number,
    error: String,
    createdAt: { type: Date, default: Date.now, expires: '24h' }
});

const userSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    phoneNumber: String,
    links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Link' }],
    claimSession: {
        active: { type: Boolean, default: false },
        currentIndex: { type: Number, default: 0 }
    }
});

const Link = mongoose.model('Link', linkSchema);
const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI).then(() => console.log('✅ MongoDB Connected'));

// Initialize Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ========== EXACT ENCRYPTION FUNCTION ==========
function encryptPayload(payload) {
    try {
        // Exact same as original website
        const key = CryptoJS.enc.Utf8.parse('12345678901234567890123456789012');
        const iv = CryptoJS.enc.Utf8.parse('1234567890123456');
        const jsonString = JSON.stringify(payload);
        const encrypted = CryptoJS.AES.encrypt(jsonString, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return encrypted.toString();
    } catch (e) {
        console.error('Encryption error:', e);
        return '';
    }
}

// ========== MAIN CLAIM FUNCTION ==========
async function claimLifafa(chatId, lifafaId, phoneNumber) {
    try {
        // Step 1: Prepare payload EXACTLY like website
        const payload = {
            action: "claimlifafa",
            lid: lifafaId,
            number: phoneNumber,
            accessCode: "",
            referid: "",
            selected: ""
        };
        
        console.log('📤 Payload:', payload);
        
        // Step 2: Encrypt payload
        const encryptedData = encryptPayload(payload);
        
        // Step 3: Send to handler
        const formData = new URLSearchParams();
        formData.append('data', encryptedData);
        
        const response = await axios.post('https://mahakalxlifafa.in/handler', formData, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        
        console.log('📥 Response:', response.data);
        
        // Step 4: Parse response
        if (response.data && response.data.status === "success") {
            const isSuccess = response.data.claim_status !== "tried";
            const amount = isSuccess ? (response.data.perUser || 4) : 0;
            
            return {
                success: isSuccess,
                amount: amount,
                message: response.data.message || (isSuccess ? '✅ Success' : '❌ Already tried'),
                raw: response.data
            };
        }
        
        return { success: false, error: 'Invalid response', amount: 0 };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message, amount: 0 };
    }
}

// ========== SIMPLE MENU ==========
const mainMenu = {
    reply_markup: {
        keyboard: [
            ['📤 Send Links', '📊 Status'],
            ['📞 Set Phone', '🚀 Start Claim'],
            ['📈 Stats']
        ],
        resize_keyboard: true
    }
};

// ========== START COMMAND ==========
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    await User.findOneAndUpdate(
        { chatId },
        { username: msg.from.username },
        { upsert: true }
    );
    
    bot.sendMessage(chatId,
        `🎁 *Lifafa Auto-Claim Bot*\n\n` +
        `1️⃣ Send your lifafa links\n` +
        `2️⃣ Set your 10-digit phone number\n` +
        `3️⃣ Click Start Claim\n\n` +
        `⏱️ 30 sec delay between claims`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// ========== HANDLE MESSAGES ==========
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Menu buttons
    if (text === '📤 Send Links') {
        bot.sendMessage(chatId, 'Send your lifafa links (one or multiple)');
        return;
    }
    
    if (text === '📊 Status') {
        await showStatus(chatId);
        return;
    }
    
    if (text === '📞 Set Phone') {
        bot.sendMessage(chatId, 'Send your 10-digit phone number');
        return;
    }
    
    if (text === '🚀 Start Claim') {
        await startClaiming(chatId);
        return;
    }
    
    if (text === '📈 Stats') {
        await showStats(chatId);
        return;
    }
    
    // Phone number
    if (/^\d{10}$/.test(text)) {
        await User.findOneAndUpdate(
            { chatId },
            { phoneNumber: text },
            { upsert: true }
        );
        bot.sendMessage(chatId, `✅ Phone saved: ${text}`, mainMenu);
        return;
    }
    
    // Links
    if (text.includes('lifafa') || text.includes('http')) {
        await saveLinks(chatId, text);
        return;
    }
    
    bot.sendMessage(chatId, '❌ Send link or phone number');
});

// ========== SAVE LINKS FUNCTION ==========
async function saveLinks(chatId, text) {
    try {
        // Split multiple links
        const links = text.split('\n').filter(l => l.trim());
        let saved = 0;
        let duplicates = 0;
        
        for (const link of links) {
            // Extract lifafa ID
            let lifafaId = 'default';
            const match = link.match(/[?&]i=([^&]+)/);
            if (match) lifafaId = match[1];
            
            // Check duplicate
            const exists = await Link.findOne({ chatId, link });
            if (exists) {
                duplicates++;
                continue;
            }
            
            // Save
            const newLink = new Link({
                chatId,
                link: link.trim(),
                lifafaId,
                status: 'pending'
            });
            
            await newLink.save();
            
            await User.findOneAndUpdate(
                { chatId },
                { $push: { links: newLink._id } },
                { upsert: true }
            );
            
            saved++;
        }
        
        const total = await Link.countDocuments({ chatId });
        bot.sendMessage(chatId, 
            `✅ Saved: ${saved} new\n` +
            `🔄 Duplicate: ${duplicates}\n` +
            `📚 Total: ${total}`,
            mainMenu
        );
        
    } catch (error) {
        bot.sendMessage(chatId, '❌ Error saving links');
    }
}

// ========== SHOW STATUS ==========
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
    
    bot.sendMessage(chatId,
        `📊 *Status*\n\n` +
        `Total: ${links.length}\n` +
        `⏳ Pending: ${pending}\n` +
        `✅ Claimed: ${claimed}\n` +
        `❌ Failed: ${failed}\n` +
        `💰 Amount: ₹${totalAmount}\n` +
        `📞 Phone: ${user?.phoneNumber || 'Not set'}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
}

// ========== SHOW STATS ==========
async function showStats(chatId) {
    const links = await Link.find({ chatId });
    
    const claimed = links.filter(l => l.status === 'claimed').length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    const selected = links.filter(l => l.amount > 0).length;
    
    bot.sendMessage(chatId,
        `📈 *Statistics*\n\n` +
        `Total Claims: ${claimed}\n` +
        `Selected: ${selected}\n` +
        `Total Amount: ₹${totalAmount}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
}

// ========== START CLAIMING ==========
async function startClaiming(chatId) {
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
    
    // Start session
    await User.findOneAndUpdate(
        { chatId },
        {
            'claimSession.active': true,
            'claimSession.currentIndex': 0
        }
    );
    
    bot.sendMessage(chatId, `🚀 Starting claim for ${links.length} links...`);
    processNext(chatId, 0);
}

// ========== PROCESS NEXT LINK ==========
async function processNext(chatId, index) {
    const user = await User.findOne({ chatId });
    if (!user?.claimSession?.active) return;
    
    const links = await Link.find({ chatId, status: 'pending' });
    
    if (index >= links.length) {
        await User.findOneAndUpdate({ chatId }, { 'claimSession.active': false });
        bot.sendMessage(chatId, '✅ All links processed!', mainMenu);
        return;
    }
    
    const link = links[index];
    
    // Show progress
    bot.sendMessage(chatId, `🔄 *${index+1}/${links.length}*\nTrying: ${link.lifafaId}`);
    
    // Claim
    const result = await claimLifafa(chatId, link.lifafaId, user.phoneNumber);
    
    if (result.success) {
        await Link.findByIdAndUpdate(link._id, {
            status: 'claimed',
            amount: result.amount
        });
        
        bot.sendMessage(chatId, `✅ Won: ₹${result.amount}`);
        
    } else {
        await Link.findByIdAndUpdate(link._id, {
            status: 'failed',
            error: result.error
        });
        
        bot.sendMessage(chatId, `❌ Failed: ${result.error || 'Error'}`);
    }
    
    // Next after 30 seconds
    setTimeout(() => processNext(chatId, index + 1), 30000);
}

// ========== WEB SERVER ==========
app.get('/', (req, res) => {
    res.send('🤖 Lifafa Bot Running');
});

app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});

console.log('🤖 Bot Started - Ready to claim!');
