// index.js - UNIVERSAL LINK DETECTOR
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const express = require('express');

// ========== CONFIGURATION ==========
const TELEGRAM_TOKEN = '8237728017:AAFCSh-ETOJ4VspQVvazB7FLm_i55bX9x5U';
const MONGODB_URI = 'mongodb+srv://amittgofficial_db_user:Amit70615544@cluster0.vqfljne.mongodb.net/lifafa-bot?retryWrites=true&w=majority';
const ENCRYPTION_KEY = '12345678901234567890123456789012';
const ENCRYPTION_IV = '1234567890123456';
const PORT = process.env.PORT || 3000;

// ========== EXPRESS SERVER FOR RENDER ==========
const app = express();

// Health check endpoint for Render
app.get('/', (req, res) => {
    res.send('🤖 Telegram Bot is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date() });
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ========== MONGODB CONNECTION ==========
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err.message));

// ========== SCHEMAS ==========
const lifafaSchema = new mongoose.Schema({
    chatId: Number,
    link: String,
    lifafaId: String,
    status: { type: String, default: 'pending' },
    amount: { type: Number, default: 0 },
    claimedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    phoneNumbers: [String],
    currentPhone: String,
    stats: {
        totalLifafas: { type: Number, default: 0 },
        totalSuccess: { type: Number, default: 0 },
        totalFailed: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 }
    }
});

const Lifafa = mongoose.model('Lifafa', lifafaSchema);
const User = mongoose.model('User', userSchema);

// ========== INITIALIZE BOT ==========
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: true,
    request: {
        timeout: 30000 // 30 second timeout
    }
});

console.log('🤖 Bot Started - Universal Link Detector');
console.log('📱 Deployed on Render with 2s delay');

// ========== ENCRYPTION FUNCTION ==========
function encryptPayload(payload) {
    try {
        const key = CryptoJS.enc.Utf8.parse(ENCRYPTION_KEY);
        const iv = CryptoJS.enc.Utf8.parse(ENCRYPTION_IV);
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), key, { iv: iv });
        return encrypted.toString();
    } catch (e) {
        return '';
    }
}

// ========== UNIVERSAL LINK DETECTOR ==========
function extractAllLinks(text) {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = text.match(urlRegex);
    
    if (!matches || matches.length === 0) return [];
    
    const uniqueLinks = [...new Set(matches)];
    
    const lifafaLinks = uniqueLinks.filter(link => 
        link.includes('lifafa') || link.includes('i=')
    );
    
    return lifafaLinks.length > 0 ? lifafaLinks : uniqueLinks;
}

// ========== EXTRACT LIFAFA ID ==========
function extractLifafaId(link) {
    const match = link.match(/[?&]i=([^&]+)/);
    return match ? match[1] : link.split('/').pop();
}

// ========== MAIN MENU ==========
const mainMenu = {
    reply_markup: {
        keyboard: [
            ['📊 Status', '📞 Set Number'],
            ['🚀 Claim All', '📈 Stats'],
            ['🗑️ Clear All']
        ],
        resize_keyboard: true
    }
};

// ========== START COMMAND ==========
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        let user = await User.findOne({ chatId });
        if (!user) {
            user = new User({ chatId });
            await user.save();
        }
        
        const totalLifafas = await Lifafa.countDocuments({ chatId });
        
        bot.sendMessage(chatId,
            `🎯 *Universal Link Detector*\n\n` +
            `✅ *How to use:*\n` +
            `• Forward any post/message\n` +
            `• Bot auto-detects all links\n` +
            `• Supports any format\n\n` +
            `📊 *Saved Links:* ${totalLifafas}\n\n` +
            `👇 *Select option:*`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.log('Start error:', error.message);
        bot.sendMessage(chatId, '❌ Error occurred. Please try again.', mainMenu);
    }
});

// ========== UNIVERSAL MESSAGE HANDLER ==========
bot.on('message', async (msg) => {
    if (!msg.text && !msg.caption) return;
    
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';
    
    try {
        // Handle menu buttons
        if (text === '📊 Status') {
            await showStatus(chatId);
            return;
        }
        
        if (text === '📞 Set Number') {
            bot.sendMessage(chatId, 
                `📞 *Send 10 digit phone number:*`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        if (text === '🚀 Claim All') {
            await startClaiming(chatId);
            return;
        }
        
        if (text === '📈 Stats') {
            await showStats(chatId);
            return;
        }
        
        if (text === '🗑️ Clear All') {
            const count = await Lifafa.countDocuments({ chatId });
            await Lifafa.deleteMany({ chatId });
            await User.findOneAndUpdate(
                { chatId }, 
                { stats: { totalLifafas: 0, totalSuccess: 0, totalFailed: 0, totalAmount: 0 } }
            );
            bot.sendMessage(chatId, `🗑️ Cleared ${count} links`, mainMenu);
            return;
        }
        
        // ===== UNIVERSAL LINK DETECTION =====
        const detectedLinks = extractAllLinks(text);
        
        if (detectedLinks.length > 0) {
            await saveDetectedLinks(chatId, detectedLinks);
            return;
        }
        
        // Check for phone number
        if (/^\d{10}$/.test(text.trim())) {
            await savePhoneNumber(chatId, text.trim());
            return;
        }
    } catch (error) {
        console.log('Message handler error:', error.message);
    }
});

// ========== SAVE DETECTED LINKS ==========
async function saveDetectedLinks(chatId, links) {
    try {
        let saved = 0;
        let duplicates = 0;
        
        for (const link of links) {
            const lifafaId = extractLifafaId(link);
            
            const exists = await Lifafa.findOne({ chatId, link: link });
            if (!exists) {
                const newLifafa = new Lifafa({
                    chatId,
                    link: link,
                    lifafaId: lifafaId,
                    status: 'pending'
                });
                await newLifafa.save();
                saved++;
            } else {
                duplicates++;
            }
        }
        
        const total = await Lifafa.countDocuments({ chatId });
        
        // Update user stats
        await User.findOneAndUpdate(
            { chatId },
            { 'stats.totalLifafas': total }
        );
        
        // Short professional response
        let response = `✅ *${saved} link(s) saved successfully*\n`;
        response += `📊 Total: ${total}`;
        
        if (duplicates > 0) {
            response += `\n⚠️ Duplicates: ${duplicates}`;
        }
        
        bot.sendMessage(chatId, response, { parse_mode: 'Markdown', ...mainMenu });
        
    } catch (error) {
        console.log('Save error:', error.message);
        bot.sendMessage(chatId, '❌ Error saving links', mainMenu);
    }
}

// ========== SAVE PHONE NUMBER ==========
async function savePhoneNumber(chatId, number) {
    try {
        // Check if number is different from current
        const user = await User.findOne({ chatId });
        const isNewNumber = !user?.currentPhone || user.currentPhone !== number;
        
        // Update user with new number
        await User.findOneAndUpdate(
            { chatId },
            { 
                phoneNumbers: [number], 
                currentPhone: number 
            },
            { upsert: true }
        );
        
        let resetMessage = '';
        
        // If it's a new number, reset ALL links to pending
        if (isNewNumber) {
            const result = await Lifafa.updateMany(
                { chatId },
                { status: 'pending' }  // Reset all links to pending
            );
            
            if (result.modifiedCount > 0) {
                resetMessage = `\n🔄 Reset ${result.modifiedCount} links for new number`;
            }
        }
        
        const total = await Lifafa.countDocuments({ chatId });
        const pending = await Lifafa.countDocuments({ chatId, status: 'pending' });
        
        bot.sendMessage(chatId, 
            `✅ *Phone number updated*\n📞 ${number}\n\n` +
            `📊 Total links: ${total}\n` +
            `⏳ Ready to claim: ${pending}${resetMessage}`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.log('Save phone error:', error.message);
        bot.sendMessage(chatId, '❌ Error saving number', mainMenu);
    }
}

// ========== SHOW STATUS ==========
async function showStatus(chatId) {
    try {
        const lifafas = await Lifafa.find({ chatId }).sort({ createdAt: -1 });
        const user = await User.findOne({ chatId });
        
        const pending = lifafas.filter(l => l.status === 'pending').length;
        const success = lifafas.filter(l => l.status === 'success').length;
        const failed = lifafas.filter(l => l.status === 'failed').length;
        const totalAmount = lifafas.reduce((sum, l) => sum + (l.amount || 0), 0);
        
        let recentText = '';
        if (lifafas.length > 0) {
            recentText = '\n📌 *Recent:*\n';
            lifafas.slice(0, 3).forEach(l => {
                const emoji = l.status === 'success' ? '✅' : l.status === 'failed' ? '❌' : '⏳';
                recentText += `${emoji} \`${l.lifafaId}\` ${l.amount > 0 ? '₹'+l.amount : ''}\n`;
            });
        }
        
        bot.sendMessage(chatId,
            `📊 *Status*\n\n` +
            `Total: ${lifafas.length}\n` +
            `Pending: ${pending}\n` +
            `Success: ${success}\n` +
            `Failed: ${failed}\n` +
            `Amount: ₹${totalAmount}\n` +
            `Phone: ${user?.currentPhone || 'Not set'}` +
            recentText,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.log('Show status error:', error.message);
    }
}

// ========== SHOW STATS ==========
async function showStats(chatId) {
    try {
        const lifafas = await Lifafa.find({ chatId });
        
        const success = lifafas.filter(l => l.status === 'success').length;
        const failed = lifafas.filter(l => l.status === 'failed').length;
        const totalAmount = lifafas.reduce((sum, l) => sum + (l.amount || 0), 0);
        
        const successRate = lifafas.length > 0 ? 
            Math.round((success / lifafas.length) * 100) : 0;
        
        bot.sendMessage(chatId,
            `📈 *Statistics*\n\n` +
            `Total: ${lifafas.length}\n` +
            `Success: ${success}\n` +
            `Failed: ${failed}\n` +
            `Amount: ₹${totalAmount}\n` +
            `Rate: ${successRate}%`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.log('Show stats error:', error.message);
    }
}

// ========== CLAIM FUNCTION ==========
async function claimLifafa(lifafaId, phoneNumber) {
    try {
        const payload = {
            action: "claimlifafa",
            lid: lifafaId,
            number: phoneNumber,
            accessCode: "",
            referid: "",
            selected: ""
        };
        
        const encrypted = encryptPayload(payload);
        const formData = new URLSearchParams();
        formData.append('data', encrypted);
        
        const response = await axios.post('https://mahakalxlifafa.in/handler', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });
        
        // Response check
        if (response.data?.status === "success") {
            const isSuccess = response.data.claim_status !== "tried";
            
            // Exact amount jo API ne diya
            let amount = 0;
            if (isSuccess) {
                // perUser field mein amount hota hai
                amount = response.data.perUser || 0;
                console.log(`💰 Amount received: ₹${amount} for ${lifafaId}`);
            }
            
            return {
                success: isSuccess,
                amount: amount  // Exact API amount
            };
        }
        
        return { success: false, amount: 0 };
    } catch (error) {
        console.log('Claim error for', lifafaId, ':', error.message);
        return { success: false, amount: 0 };
    }
}

// ========== START CLAIMING ==========
async function startClaiming(chatId) {
    try {
        const user = await User.findOne({ chatId });
        const lifafas = await Lifafa.find({ chatId, status: 'pending' });
        
        if (!user?.currentPhone) {
            bot.sendMessage(chatId, '❌ *Set phone number first*', mainMenu);
            return;
        }
        
        if (lifafas.length === 0) {
            bot.sendMessage(chatId, '❌ *No pending links*', mainMenu);
            return;
        }
        
        // Initial message that will be updated
        let statusMsg = await bot.sendMessage(chatId, 
            `⏳ *Claiming ${lifafas.length} lifafas...*\n\n` +
            `━━━━━━━━━━━━━━━`, 
            { parse_mode: 'Markdown' }
        );
        
        let success = 0;
        let failed = 0;
        let totalAmount = 0;
        let resultText = '';
        
        for (let i = 0; i < lifafas.length; i++) {
            const lifafa = lifafas[i];
            
            const result = await claimLifafa(lifafa.lifafaId, user.currentPhone);
            
            if (result.success) {
                success++;
                totalAmount += result.amount;
                lifafa.status = 'success';
                lifafa.amount = result.amount;
                resultText += `#${i+1}: \`${lifafa.lifafaId}\` - ✅ Selected (₹${result.amount})\n`;
            } else {
                failed++;
                lifafa.status = 'failed';
                resultText += `#${i+1}: \`${lifafa.lifafaId}\` - ❌ Not selected\n`;
            }
            
            await lifafa.save();
            
            // Update status message
            await bot.editMessageText(
                `⏳ *Claiming ${lifafas.length} lifafas...*\n\n` +
                `${resultText}\n` +
                `━━━━━━━━━━━━━━━`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
            
            // Update stats
            await User.findOneAndUpdate(
                { chatId },
                {
                    stats: {
                        totalLifafas: lifafas.length,
                        totalSuccess: success,
                        totalFailed: failed,
                        totalAmount: totalAmount
                    }
                }
            );
            
            // 2 SECONDS DELAY
            if (i < lifafas.length - 1) {
                // Update waiting message
                await bot.editMessageText(
                    `⏳ *Claiming ${lifafas.length} lifafas...*\n\n` +
                    `${resultText}\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `⏱️ Waiting 2 seconds...`,
                    {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Final summary - update the same message
        await bot.editMessageText(
            `✅ *Claiming Complete!*\n\n` +
            `${resultText}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📊 *Summary:*\n` +
            `Total: ${lifafas.length}\n` +
            `✅ Selected: ${success}\n` +
            `❌ Not selected: ${failed}\n` +
            `💰 Total amount: ₹${totalAmount}`,
            {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                ...mainMenu
            }
        );
    } catch (error) {
        console.log('Claiming error:', error.message);
        bot.sendMessage(chatId, '❌ Error during claiming process', mainMenu);
    }
}

// ========== ERROR HANDLER ==========
bot.on('polling_error', (error) => {
    console.log('Polling error:', error.message);
});

bot.on('webhook_error', (error) => {
    console.log('Webhook error:', error.message);
});

console.log('✅ Bot Ready - Forward any post!');
console.log('⏱️ Delay set to 2 seconds between claims');
