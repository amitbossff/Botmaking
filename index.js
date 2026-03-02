// index.js - UNIVERSAL LINK DETECTOR
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const express = require('express');

// ========== CONFIGURATION ==========
const TELEGRAM_TOKEN = '8603310729:AAFPtxjvuhTxhWWeHO70ApwyzLsmQVmZ2IM';
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
    claimedBy: [String],
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
        timeout: 30000
    }
});

console.log('🤖 Bot Started - Universal Link Detector');

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
                    status: 'pending',
                    claimedBy: []
                });
                await newLifafa.save();
                saved++;
            } else {
                duplicates++;
            }
        }
        
        const total = await Lifafa.countDocuments({ chatId });
        
        await User.findOneAndUpdate(
            { chatId },
            { 'stats.totalLifafas': total }
        );
        
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
        const user = await User.findOneAndUpdate(
            { chatId },
            { 
                $addToSet: { phoneNumbers: number },
                currentPhone: number 
            },
            { upsert: true, new: true }
        );
        
        const totalLinks = await Lifafa.countDocuments({ chatId });
        const pendingForThisNumber = await Lifafa.countDocuments({ 
            chatId, 
            claimedBy: { $ne: number }
        });
        
        bot.sendMessage(chatId, 
            `✅ *Phone number updated*\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📞 ${number}\n` +
            `📊 Total Links: ${totalLinks}\n` +
            `🆕 Pending for this number: ${pendingForThisNumber}\n` +
            `━━━━━━━━━━━━━━━`,
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
        
        const currentPhone = user?.currentPhone;
        let pending = 0;
        let success = 0;
        let failed = 0;
        
        if (currentPhone) {
            pending = lifafas.filter(l => !l.claimedBy.includes(currentPhone)).length;
            success = lifafas.filter(l => l.claimedBy.includes(currentPhone) && l.status === 'success').length;
            failed = lifafas.filter(l => l.claimedBy.includes(currentPhone) && l.status === 'failed').length;
        } else {
            pending = lifafas.filter(l => l.status === 'pending').length;
            success = lifafas.filter(l => l.status === 'success').length;
            failed = lifafas.filter(l => l.status === 'failed').length;
        }
        
        let recentText = '\n📌 *Recent:*\n';
        lifafas.slice(0, 3).forEach(l => {
            const claimedByCurrent = currentPhone && l.claimedBy.includes(currentPhone);
            let emoji = '⏳';
            if (claimedByCurrent) {
                emoji = l.status === 'success' ? '✅' : '❌';
            }
            recentText += `${emoji} \`${l.lifafaId}\`\n`;
        });
        
        bot.sendMessage(chatId,
            `📊 *Status*\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📞 Current: ${currentPhone || 'Not set'}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📌 Total: ${lifafas.length}\n` +
            `⏳ Pending: ${pending}\n` +
            `✅ Success: ${success}\n` +
            `❌ Failed: ${failed}\n` +
            `━━━━━━━━━━━━━━━` +
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
        const user = await User.findOne({ chatId });
        
        const currentPhone = user?.currentPhone;
        
        const success = lifafas.filter(l => l.claimedBy.includes(currentPhone) && l.status === 'success').length;
        const failed = lifafas.filter(l => l.claimedBy.includes(currentPhone) && l.status === 'failed').length;
        const total = success + failed;
        
        const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
        
        bot.sendMessage(chatId,
            `📈 *Statistics for ${currentPhone}*\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📌 Attempted: ${total}\n` +
            `✅ Success: ${success}\n` +
            `❌ Failed: ${failed}\n` +
            `📊 Rate: ${successRate}%\n` +
            `━━━━━━━━━━━━━━━`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.log('Show stats error:', error.message);
    }
}

// ========== CLAIM FUNCTION - FIXED ==========
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
        
        console.log(`🔄 Claiming ${lifafaId} for ${phoneNumber}`);
        
        const response = await axios.post('https://mahakalxlifafa.in/handler', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });
        
        // Log full response for debugging
        console.log('API Response:', JSON.stringify(response.data, null, 2));
        
        // Check different response formats
        if (response.data) {
            // Case 1: Success with claim_status
            if (response.data.status === "success") {
                const isSuccess = response.data.claim_status === "success" || 
                                 response.data.claim_status === "claimed" ||
                                 response.data.message?.toLowerCase().includes('success') ||
                                 response.data.msg?.toLowerCase().includes('success');
                
                return {
                    success: isSuccess,
                    amount: 0
                };
            }
            
            // Case 2: Direct success message
            if (response.data.claim_status === "success" || 
                response.data.claim_status === "claimed") {
                return {
                    success: true,
                    amount: 0
                };
            }
            
            // Case 3: Message-based success
            const msg = response.data.msg || response.data.message || '';
            if (msg.toLowerCase().includes('success') || 
                msg.toLowerCase().includes('claimed') ||
                msg.toLowerCase().includes('selected')) {
                return {
                    success: true,
                    amount: 0
                };
            }
        }
        
        // Default: consider as failed
        return { success: false, amount: 0 };
        
    } catch (error) {
        console.log('Claim error details:', error.message);
        if (error.response) {
            console.log('Error response:', error.response.data);
        }
        return { success: false, amount: 0 };
    }
}

// ========== START CLAIMING - FIXED ==========
async function startClaiming(chatId) {
    try {
        const user = await User.findOne({ chatId });
        
        if (!user?.currentPhone) {
            bot.sendMessage(chatId, '❌ *Set phone number first*', mainMenu);
            return;
        }
        
        // Find links NOT claimed by current phone number
        const pendingLifafas = await Lifafa.find({ 
            chatId, 
            claimedBy: { $ne: user.currentPhone }
        });
        
        if (pendingLifafas.length === 0) {
            const totalLinks = await Lifafa.countDocuments({ chatId });
            const claimedLinks = await Lifafa.countDocuments({ 
                chatId, 
                claimedBy: user.currentPhone 
            });
            
            if (totalLinks > 0) {
                bot.sendMessage(chatId, 
                    `⚠️ *All links already claimed with ${user.currentPhone}*\n\n` +
                    `📊 Total Links: ${totalLinks}\n` +
                    `✅ Already Claimed: ${claimedLinks}\n\n` +
                    `💡 Set a different number to claim again!`,
                    { parse_mode: 'Markdown', ...mainMenu }
                );
            } else {
                bot.sendMessage(chatId, '❌ *No links saved*', mainMenu);
            }
            return;
        }
        
        // Send initial message
        const initialMsg = await bot.sendMessage(chatId, 
            `🚀 *Starting Claim Process*\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📞 Phone: ${user.currentPhone}\n` +
            `📊 Available: ${pendingLifafas.length}\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            `⏳ Processing: 0/${pendingLifafas.length}\n` +
            `✅ Selected: 0\n` +
            `❌ Not Selected: 0\n\n` +
            `⏱️ Next update in 2 seconds...`,
            { parse_mode: 'Markdown' }
        );
        
        let success = 0;
        let failed = 0;
        
        for (let i = 0; i < pendingLifafas.length; i++) {
            const lifafa = pendingLifafas[i];
            
            try {
                // Claim the lifafa
                const result = await claimLifafa(lifafa.lifafaId, user.currentPhone);
                
                // Mark as claimed by this number
                lifafa.claimedBy.push(user.currentPhone);
                
                if (result.success) {
                    success++;
                    lifafa.status = 'success';
                    console.log(`✅ Success: ${lifafa.lifafaId}`);
                } else {
                    failed++;
                    lifafa.status = 'failed';
                    console.log(`❌ Failed: ${lifafa.lifafaId}`);
                }
                
                await lifafa.save();
                
            } catch (claimError) {
                console.log(`Error claiming ${lifafa.lifafaId}:`, claimError.message);
                failed++;
                lifafa.claimedBy.push(user.currentPhone);
                lifafa.status = 'failed';
                await lifafa.save();
            }
            
            // Update stats in user document
            await User.findOneAndUpdate(
                { chatId },
                {
                    'stats.totalSuccess': success,
                    'stats.totalFailed': failed
                }
            );
            
            // Update the main message
            try {
                await bot.editMessageText(
                    `🚀 *Claiming...*\n\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `📞 Phone: ${user.currentPhone}\n` +
                    `📊 Available: ${pendingLifafas.length}\n` +
                    `━━━━━━━━━━━━━━━\n\n` +
                    `⏳ Processing: ${i + 1}/${pendingLifafas.length}\n` +
                    `✅ Selected: ${success}\n` +
                    `❌ Not Selected: ${failed}\n\n` +
                    `⏱️ ${i < pendingLifafas.length - 1 ? 'Next in 2 seconds...' : 'Finishing up...'}`,
                    {
                        chat_id: chatId,
                        message_id: initialMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
            } catch (e) {
                // Ignore edit errors
            }
            
            // 2 seconds delay between claims
            if (i < pendingLifafas.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Final success message
        await bot.editMessageText(
            `✅ *Claiming Complete!*\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📞 Phone: ${user.currentPhone}\n` +
            `📊 Total Attempted: ${pendingLifafas.length}\n` +
            `✅ Selected: ${success}\n` +
            `❌ Not Selected: ${failed}\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            `💡 Set another number to claim again!`,
            {
                chat_id: chatId,
                message_id: initialMsg.message_id,
                parse_mode: 'Markdown',
                ...mainMenu
            }
        );
        
    } catch (error) {
        console.log('Claiming process error:', error.message);
        console.log('Error stack:', error.stack);
        bot.sendMessage(chatId, '❌ Error during claiming process. Please try again.', mainMenu);
    }
}

// ========== ERROR HANDLER ==========
bot.on('polling_error', (error) => {
    console.log('Polling error:', error.message);
});

bot.on('webhook_error', (error) => {
    console.log('Webhook error:', error.message);
});

console.log('✅ Bot Ready - Fully Fixed!');
console.log('⏱️ Links persist for multiple numbers');
console.log('📱 Success/Failure now working correctly');
