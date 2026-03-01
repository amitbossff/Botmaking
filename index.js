// index.js - VERIFICATION + CLAIM BOTH
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const axios = require('axios');

const app = express();
app.use(express.json());

// Your credentials
const TELEGRAM_TOKEN = '8603310729:AAFPtxjvuhTxhWWeHO70ApwyzLsmQVmZ2IM';
const MONGODB_URI = 'mongodb+srv://amittgofficial_db_user:Amit70615544@cluster0.vqfljne.mongodb.net/lifafa-bot?retryWrites=true&w=majority';
const PORT = process.env.PORT || 3000;

// MongoDB Schema
const linkSchema = new mongoose.Schema({
    chatId: Number,
    link: String,
    lifafaId: String,
    tParam: String,        // Important: t parameter from verification link
    verified: { type: Boolean, default: false },
    verifiedData: Object,
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

// ========== ENCRYPTION FUNCTION ==========
function encryptPayload(payload) {
    try {
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

// ========== STEP 1: VERIFY LINK ==========
async function verifyLink(lifafaId, tParam) {
    try {
        // Visit the verification page first
        const verifyUrl = `https://mahakalxlifafa.in/lifafa.php?i=${lifafaId}&t=${tParam}`;
        
        const response = await axios.get(verifyUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        
        // Check if verification successful
        if (response.data && response.data.includes('Claim your special gift')) {
            return {
                success: true,
                message: 'Verification successful'
            };
        }
        
        return { success: false, error: 'Verification failed' };
        
    } catch (error) {
        console.error('Verify error:', error.message);
        return { success: false, error: error.message };
    }
}

// ========== STEP 2: CLAIM AFTER VERIFICATION ==========
async function claimAfterVerify(lifafaId, phoneNumber, tParam) {
    try {
        // First verify
        const verifyResult = await verifyLink(lifafaId, tParam);
        if (!verifyResult.success) {
            return { success: false, error: 'Verification failed', step: 'verify' };
        }
        
        // Then claim
        const payload = {
            action: "claimlifafa",
            lid: lifafaId,
            number: phoneNumber,
            accessCode: "",
            referid: "",
            selected: ""
        };
        
        const encryptedData = encryptPayload(payload);
        
        const formData = new URLSearchParams();
        formData.append('data', encryptedData);
        
        const claimResponse = await axios.post('https://mahakalxlifafa.in/handler', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        
        if (claimResponse.data && claimResponse.data.status === "success") {
            const isSuccess = claimResponse.data.claim_status !== "tried";
            const amount = isSuccess ? (claimResponse.data.perUser || 4) : 0;
            
            return {
                success: isSuccess,
                amount: amount,
                message: claimResponse.data.message,
                step: 'claim',
                raw: claimResponse.data
            };
        }
        
        return { success: false, error: 'Claim failed', step: 'claim' };
        
    } catch (error) {
        return { success: false, error: error.message, step: 'claim' };
    }
}

// ========== MAIN MENU ==========
const mainMenu = {
    reply_markup: {
        keyboard: [
            ['📤 Send Links', '📊 Status'],
            ['📞 Set Phone', '🚀 Start Claim'],
            ['📈 Stats', '🗑️ Clear']
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
        `1️⃣ Send your lifafa links (with t parameter)\n` +
        `2️⃣ Set your phone number\n` +
        `3️⃣ Click Start Claim\n\n` +
        `✅ Bot will verify first, then claim`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// ========== HANDLE MESSAGES ==========
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Menu handlers
    if (text === '📤 Send Links') {
        bot.sendMessage(chatId, 'Send your lifafa.php links (with ?i= and &t=)');
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
        await startClaimProcess(chatId);
        return;
    }
    
    if (text === '📈 Stats') {
        await showStats(chatId);
        return;
    }
    
    if (text === '🗑️ Clear') {
        await Link.deleteMany({ chatId });
        await User.findOneAndUpdate({ chatId }, { links: [] });
        bot.sendMessage(chatId, '🗑️ All cleared!', mainMenu);
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
    
    // Save links (lifafa.php links)
    if (text.includes('lifafa.php') && text.includes('i=') && text.includes('t=')) {
        await saveLinkWithTParam(chatId, text);
        return;
    }
    
    bot.sendMessage(chatId, '❌ Invalid. Send lifafa.php link with i and t parameters');
});

// ========== SAVE LINK WITH T PARAMETER ==========
async function saveLinkWithTParam(chatId, link) {
    try {
        // Extract i and t parameters
        const iMatch = link.match(/[?&]i=([^&]+)/);
        const tMatch = link.match(/[?&]t=([^&]+)/);
        
        if (!iMatch || !tMatch) {
            bot.sendMessage(chatId, '❌ Invalid link format. Need both i and t parameters');
            return;
        }
        
        const lifafaId = iMatch[1];
        const tParam = tMatch[1];
        
        // Check duplicate
        const exists = await Link.findOne({ chatId, lifafaId });
        if (exists) {
            bot.sendMessage(chatId, '⚠️ Link already exists');
            return;
        }
        
        // Save with t parameter
        const newLink = new Link({
            chatId,
            link,
            lifafaId,
            tParam,
            verified: false,
            status: 'pending'
        });
        
        await newLink.save();
        
        await User.findOneAndUpdate(
            { chatId },
            { $push: { links: newLink._id } },
            { upsert: true }
        );
        
        const total = await Link.countDocuments({ chatId });
        bot.sendMessage(chatId, 
            `✅ Saved: ${lifafaId}\n` +
            `📊 Total: ${total}\n` +
            `🔑 t: ${tParam}`,
            mainMenu
        );
        
    } catch (error) {
        bot.sendMessage(chatId, '❌ Error saving link');
    }
}

// ========== SHOW STATUS ==========
async function showStatus(chatId) {
    const links = await Link.find({ chatId });
    const user = await User.findOne({ chatId });
    
    if (links.length === 0) {
        bot.sendMessage(chatId, '📊 No links', mainMenu);
        return;
    }
    
    const pending = links.filter(l => l.status === 'pending').length;
    const claimed = links.filter(l => l.status === 'claimed').length;
    const failed = links.filter(l => l.status === 'failed').length;
    const verified = links.filter(l => l.verified).length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    
    bot.sendMessage(chatId,
        `📊 *Status*\n\n` +
        `Total: ${links.length}\n` +
        `✅ Verified: ${verified}\n` +
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
    
    bot.sendMessage(chatId,
        `📈 *Stats*\n\n` +
        `Claimed: ${claimed}\n` +
        `Amount: ₹${totalAmount}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
}

// ========== START CLAIM PROCESS ==========
async function startClaimProcess(chatId) {
    const user = await User.findOne({ chatId });
    
    if (!user?.phoneNumber) {
        bot.sendMessage(chatId, '❌ Set phone number first', mainMenu);
        return;
    }
    
    const links = await Link.find({ 
        chatId, 
        status: 'pending' 
    });
    
    if (links.length === 0) {
        bot.sendMessage(chatId, '❌ No pending links', mainMenu);
        return;
    }
    
    await User.findOneAndUpdate(
        { chatId },
        {
            'claimSession.active': true,
            'claimSession.currentIndex': 0
        }
    );
    
    bot.sendMessage(chatId, `🚀 Starting claim for ${links.length} links...`);
    processLinkWithVerify(chatId, 0);
}

// ========== PROCESS LINK WITH VERIFY FIRST ==========
async function processLinkWithVerify(chatId, index) {
    const user = await User.findOne({ chatId });
    if (!user?.claimSession?.active) return;
    
    const links = await Link.find({ chatId, status: 'pending' });
    
    if (index >= links.length) {
        await User.findOneAndUpdate({ chatId }, { 'claimSession.active': false });
        bot.sendMessage(chatId, '✅ All done!', mainMenu);
        return;
    }
    
    const link = links[index];
    
    bot.sendMessage(chatId, 
        `🔄 *${index+1}/${links.length}*\n` +
        `ID: ${link.lifafaId}\n` +
        `Step 1: Verifying...`,
        { parse_mode: 'Markdown' }
    );
    
    // STEP 1: First verify using t parameter
    const verifyResult = await verifyLink(link.lifafaId, link.tParam);
    
    if (!verifyResult.success) {
        link.status = 'failed';
        link.error = 'Verification failed';
        await link.save();
        
        bot.sendMessage(chatId, `❌ Verification failed: ${verifyResult.error}`);
        
        setTimeout(() => processLinkWithVerify(chatId, index + 1), 30000);
        return;
    }
    
    // Mark as verified
    link.verified = true;
    await link.save();
    
    bot.sendMessage(chatId, `✅ Verified! Now claiming...`);
    
    // STEP 2: Now claim
    const claimResult = await claimAfterVerify(link.lifafaId, user.phoneNumber, link.tParam);
    
    if (claimResult.success) {
        link.status = 'claimed';
        link.amount = claimResult.amount;
        await link.save();
        
        bot.sendMessage(chatId, `✅ Claimed: ₹${claimResult.amount}`);
        
    } else {
        link.status = 'failed';
        link.error = claimResult.error;
        await link.save();
        
        bot.sendMessage(chatId, `❌ Claim failed: ${claimResult.error}`);
    }
    
    // Next after 30 seconds
    setTimeout(() => processLinkWithVerify(chatId, index + 1), 30000);
}

// ========== WEB SERVER ==========
app.get('/', (req, res) => {
    res.send('🤖 Lifafa Bot Running');
});

app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});

console.log('🤖 Bot Started - Verification + Claim Active!');
