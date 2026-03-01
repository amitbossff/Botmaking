// index.js - Main backend file
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

// Environment variables with your provided credentials
const TELEGRAM_TOKEN = '8603310729:AAFPtxjvuhTxhWWeHO70ApwyzLsmQVmZ2IM';
const MONGODB_URI = 'mongodb+srv://amittgofficial_db_user:Amit70615544@cluster0.vqfljne.mongodb.net/lifafa-bot?retryWrites=true&w=majority';
const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = '12345678901234567890123456789012';
const ENCRYPTION_IV = '1234567890123456';

// MongoDB Schemas
const linkSchema = new mongoose.Schema({
    chatId: Number,
    link: String,
    lifafaId: String,
    referId: String,
    status: { 
        type: String, 
        enum: ['pending', 'claimed', 'failed', 'expired'], 
        default: 'pending' 
    },
    claimResult: Object,
    amount: Number,
    claimTime: Date,
    error: String,
    createdAt: { 
        type: Date, 
        default: Date.now,
        expires: '24h' // Auto-delete after 24 hours
    }
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
        completedAt: Date,
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
    },
    createdAt: { type: Date, default: Date.now }
});

const Link = mongoose.model('Link', linkSchema);
const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB Connected Successfully');
}).catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
});

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Encryption function for lifafa claims
function encryptPayload(payload) {
    try {
        const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substr(0, 32);
        const iv = Buffer.from(ENCRYPTION_IV);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
        let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    } catch (e) {
        console.error('Encryption error:', e);
        return '';
    }
}

// Main menu keyboard
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📤 Send Links Now', callback_data: 'send_links' }],
            [{ text: '📊 Check Status', callback_data: 'check_status' }],
            [{ text: '📞 Set Phone Number', callback_data: 'set_phone' }],
            [{ text: '🚀 Start Claim', callback_data: 'start_claim' }],
            [{ text: '📈 Statistics', callback_data: 'statistics' }],
            [{ text: '❓ Help', callback_data: 'help' }]
        ]
    }
};

// Progress keyboard
function getProgressKeyboard(chatId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh Status', callback_data: 'check_status' }],
                [{ text: '⏸️ Pause Claim', callback_data: 'pause_claim' }],
                [{ text: '📊 Live Stats', callback_data: 'live_stats' }],
                [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
        }
    };
}

// Start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await User.findOne({ chatId });
    
    if (!user) {
        await new User({ 
            chatId,
            username: msg.from.username,
            firstName: msg.from.first_name,
            lastName: msg.from.last_name
        }).save();
    }
    
    const welcomeMsg = `🎁 *Welcome to Lifafa Auto-Claim Bot!*

🤖 I can help you automatically claim multiple lifafa links with 30-second delay between claims.

*How to use:*
1️⃣ Click "Send Links Now" to start adding links
2️⃣ Forward your lifafa links to me (I'll store them for 24h)
3️⃣ Set your 10-digit phone number
4️⃣ Click "Start Claim" to begin auto-claiming

⏰ *Features:*
• Links auto-delete after 24 hours
• 30-second delay between claims
• Live progress tracking
• Detailed statistics
• Success/Failed count

*Let's begin!* 👇`;
    
    bot.sendMessage(chatId, welcomeMsg, { 
        parse_mode: 'Markdown',
        ...mainMenu 
    });
});

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const action = callbackQuery.data;
    
    // Answer callback query
    bot.answerCallbackQuery(callbackQuery.id);
    
    switch(action) {
        case 'send_links':
            bot.sendMessage(chatId, 
                `📤 *Send Your Lifafa Links*

Please forward or send all your lifafa links now.
One link per message.

✅ Links saved for 24 hours
✅ You'll see them in status
✅ Add as many as you want

*Send your first link:*`,
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'check_status':
            await showStatus(chatId);
            break;
            
        case 'set_phone':
            bot.sendMessage(chatId,
                `📞 *Set Your Phone Number*

Please send your 10-digit phone number.

Example: \`9876543210\`

⚠️ This number will be used for all claims`,
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'start_claim':
            await startClaimProcess(chatId);
            break;
            
        case 'pause_claim':
            await pauseClaim(chatId);
            break;
            
        case 'live_stats':
            await showLiveStats(chatId);
            break;
            
        case 'statistics':
            await showStatistics(chatId);
            break;
            
        case 'main_menu':
            bot.sendMessage(chatId, '🏠 *Main Menu*', {
                parse_mode: 'Markdown',
                ...mainMenu
            });
            break;
            
        case 'help':
            bot.sendMessage(chatId,
                `❓ *Help & Commands*

📤 *Send Links* - Add new lifafa links
📊 *Status* - Check your links and progress
📞 *Set Phone* - Update your phone number
🚀 *Start Claim* - Begin auto-claiming
📈 *Statistics* - View your claim history

*Bot Commands:*
/start - Main menu
/status - Quick status
/claim - Start claiming
/clear - Clear all links

⏱️ *Delay:* 30 seconds between claims
⏰ *Link expiry:* 24 hours

Need help? Contact @admin`,
                { parse_mode: 'Markdown', ...mainMenu }
            );
            break;
    }
});

// Handle incoming messages (links and phone numbers)
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    
    // Check if it's a phone number (10 digits)
    if (/^\d{10}$/.test(text)) {
        await savePhoneNumber(chatId, text);
        return;
    }
    
    // Check if it's a lifafa link
    if (text.includes('lifafa') || text.includes('claim') || text.includes('gift') || text.startsWith('http')) {
        await saveLink(chatId, text);
        return;
    }
    
    // Unknown input
    bot.sendMessage(chatId,
        `❌ *Invalid Input*

Please either:
• Send a valid lifafa link
• Send a 10-digit phone number
• Use the menu buttons below`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Save phone number
async function savePhoneNumber(chatId, phone) {
    try {
        const user = await User.findOneAndUpdate(
            { chatId },
            { phoneNumber: phone },
            { new: true }
        );
        
        bot.sendMessage(chatId,
            `✅ *Phone Number Saved!*

📞 Number: \`${phone}\`

Now you can:
• Send more links
• Start claiming process
• Check status`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        bot.sendMessage(chatId, '❌ Error saving phone number. Please try again.');
    }
}

// Save link
async function saveLink(chatId, link) {
    try {
        // Extract lifafa ID from link
        let lifafaId = 'default';
        let referId = '';
        
        try {
            const url = new URL(link);
            lifafaId = url.searchParams.get('i') || 'default';
            referId = url.searchParams.get('ref') || '';
        } catch (e) {
            // Not a valid URL, try regex
            const match = link.match(/[?&]i=([^&]+)/);
            if (match) lifafaId = match[1];
        }
        
        // Check if link already exists for this user
        const existingLink = await Link.findOne({ chatId, link });
        if (existingLink) {
            bot.sendMessage(chatId,
                `⚠️ *Link Already Exists*

This link is already in your list.

Total links: ${await Link.countDocuments({ chatId })}`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Save new link
        const newLink = new Link({
            chatId,
            link,
            lifafaId,
            referId,
            status: 'pending'
        });
        
        await newLink.save();
        
        // Add to user's links array
        await User.findOneAndUpdate(
            { chatId },
            { $push: { links: newLink._id } }
        );
        
        const totalLinks = await Link.countDocuments({ chatId });
        
        bot.sendMessage(chatId,
            `✅ *Link Saved Successfully!*

🔗 Link: \`${link.substring(0, 50)}${link.length > 50 ? '...' : ''}\`
📊 Total Links: *${totalLinks}*
⏰ Expires in: *24 hours*

You can send more links or start claiming!`,
            { parse_mode: 'Markdown', ...mainMenu }
        );
    } catch (error) {
        console.error('Error saving link:', error);
        bot.sendMessage(chatId, '❌ Error saving link. Please try again.');
    }
}

// Show status
async function showStatus(chatId) {
    try {
        const links = await Link.find({ chatId });
        const user = await User.findOne({ chatId });
        
        if (links.length === 0) {
            bot.sendMessage(chatId,
                `📊 *Status*

You haven't added any links yet.

Click "Send Links Now" to add links.`,
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        const pending = links.filter(l => l.status === 'pending').length;
        const claimed = links.filter(l => l.status === 'claimed').length;
        const failed = links.filter(l => l.status === 'failed').length;
        const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
        
        const phoneStatus = user?.phoneNumber ? `📞 ${user.phoneNumber}` : '❌ Not set';
        
        const statusMsg = `📊 *Your Claim Status*

*Links Summary:*
• Total Links: ${links.length}
• ⏳ Pending: ${pending}
• ✅ Claimed: ${claimed}
• ❌ Failed: ${failed}
• 💰 Total Amount: ₹${totalAmount}

*Your Details:*
${phoneStatus}

*Progress:* ${claimed + failed}/${links.length} processed

${user?.claimSession?.active ? '🔄 *Claim session active*' : '⏸️ *Claim session inactive*'}`;

        // Create detailed list for small number of links
        let details = '';
        if (links.length <= 10) {
            details = '\n\n*Link Details:*\n';
            links.forEach((link, index) => {
                const statusEmoji = link.status === 'claimed' ? '✅' : 
                                   link.status === 'failed' ? '❌' : '⏳';
                details += `${index + 1}. ${statusEmoji} ₹${link.amount || 0} - ${link.link.substring(0, 30)}...\n`;
            });
        }
        
        bot.sendMessage(chatId, statusMsg + details, {
            parse_mode: 'Markdown',
            ...mainMenu
        });
    } catch (error) {
        console.error('Error showing status:', error);
        bot.sendMessage(chatId, '❌ Error fetching status. Please try again.');
    }
}

// Show live statistics
async function showLiveStats(chatId) {
    try {
        const links = await Link.find({ chatId });
        const user = await User.findOne({ chatId });
        
        const pending = links.filter(l => l.status === 'pending').length;
        const claimed = links.filter(l => l.status === 'claimed').length;
        const failed = links.filter(l => l.status === 'failed').length;
        const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
        
        // Calculate selected/unselected (assuming amount > 0 means selected)
        const selected = links.filter(l => l.amount > 0).length;
        const unselected = links.filter(l => l.amount === 0 && l.status !== 'pending').length;
        
        // Create progress bar
        const total = links.length;
        const processed = claimed + failed;
        const progressPercent = total > 0 ? (processed / total) * 100 : 0;
        const progressBar = createProgressBar(progressPercent);
        
        const statsMsg = `📊 *Live Statistics*

*Progress:*
${progressBar} ${Math.round(progressPercent)}%
${processed}/${total} processed

*Claim Results:*
• ✅ Selected: ${selected}
• ❌ Unselected: ${unselected}
• 💰 Total Amount: ₹${totalAmount}

*Details:*
• Success Rate: ${processed > 0 ? Math.round((claimed/processed)*100) : 0}%
• Average Amount: ${claimed > 0 ? Math.round(totalAmount/claimed) : 0}

*Session:*
${user?.claimSession?.active ? '🟢 Active' : '🔴 Inactive'}
Started: ${user?.claimSession?.startedAt ? new Date(user.claimSession.startedAt).toLocaleString() : 'Not started'}`;

        bot.sendMessage(chatId, statsMsg, {
            parse_mode: 'Markdown',
            ...getProgressKeyboard(chatId)
        });
    } catch (error) {
        console.error('Error showing live stats:', error);
    }
}

// Show statistics
async function showStatistics(chatId) {
    try {
        const user = await User.findOne({ chatId });
        const links = await Link.find({ chatId });
        
        const totalClaims = links.filter(l => l.status === 'claimed').length;
        const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
        const selected = links.filter(l => l.amount > 0).length;
        const unselected = links.filter(l => l.amount === 0 && l.status !== 'pending').length;
        
        const statsMsg = `📈 *Your Statistics*

*All Time:*
• Total Claims: ${user?.stats?.totalClaims || 0}
• Total Amount: ₹${user?.stats?.totalAmount || 0}
• Last Claim: ${user?.stats?.lastClaim ? new Date(user.stats.lastClaim).toLocaleString() : 'Never'}

*Current Session:*
• Total Links: ${links.length}
• Selected: ${selected}
• Unselected: ${unselected}
• Pending: ${links.filter(l => l.status === 'pending').length}
• Amount: ₹${totalAmount}

*Success Rate:* ${totalClaims > 0 ? Math.round((selected/totalClaims)*100) : 0}%`;

        bot.sendMessage(chatId, statsMsg, {
            parse_mode: 'Markdown',
            ...mainMenu
        });
    } catch (error) {
        console.error('Error showing statistics:', error);
    }
}

// Create progress bar
function createProgressBar(percent, length = 10) {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// Start claim process
async function startClaimProcess(chatId) {
    try {
        const user = await User.findOne({ chatId });
        const links = await Link.find({ chatId, status: 'pending' }).sort({ createdAt: 1 });
        
        if (!user?.phoneNumber) {
            bot.sendMessage(chatId,
                '❌ *Phone Number Required*\n\nPlease set your phone number first using "Set Phone Number" button.',
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        if (links.length === 0) {
            bot.sendMessage(chatId,
                '❌ *No Pending Links*\n\nAll links have been processed or you have no links. Add new links to continue.',
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        // Check if already claiming
        if (user.claimSession?.active) {
            bot.sendMessage(chatId,
                '🔄 *Claim Already Active*\n\nA claim session is already running. Use "Live Stats" to check progress.',
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        // Initialize claim session
        await User.findOneAndUpdate(
            { chatId },
            {
                'claimSession.active': true,
                'claimSession.startedAt': new Date(),
                'claimSession.currentIndex': 0,
                'claimSession.totalLinks': links.length,
                'claimSession.claimedLinks': 0,
                'claimSession.failedLinks': 0,
                'claimSession.totalAmount': 0,
                'claimSession.selectedCount': 0,
                'claimSession.unselectedCount': 0
            }
        );
        
        bot.sendMessage(chatId,
            `🚀 *Claim Process Started!*

📊 *Summary:*
• Total Pending Links: ${links.length}
• Phone Number: ${user.phoneNumber}
• Delay: 30 seconds between claims

⏱️ Process will begin in 5 seconds...
Use "Live Stats" to track progress.`,
            { parse_mode: 'Markdown' }
        );
        
        // Start claiming after 5 seconds
        setTimeout(() => {
            processNextLink(chatId, 0);
        }, 5000);
        
    } catch (error) {
        console.error('Error starting claim:', error);
        bot.sendMessage(chatId, '❌ Error starting claim process. Please try again.');
    }
}

// Process next link
async function processNextLink(chatId, index) {
    try {
        const user = await User.findOne({ chatId });
        
        // Check if session is still active
        if (!user?.claimSession?.active) {
            bot.sendMessage(chatId,
                '⏸️ *Claim Process Paused*\n\nClick "Start Claim" to resume.',
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        const links = await Link.find({ chatId, status: 'pending' }).sort({ createdAt: 1 });
        
        if (index >= links.length) {
            // All links processed
            await User.findOneAndUpdate(
                { chatId },
                {
                    'claimSession.active': false,
                    'claimSession.completedAt': new Date()
                }
            );
            
            const finalStats = await getFinalStats(chatId);
            
            bot.sendMessage(chatId,
                `✅ *Claim Process Completed!*

${finalStats}

🎉 All links have been processed!`,
                { parse_mode: 'Markdown', ...mainMenu }
            );
            return;
        }
        
        const link = links[index];
        
        // Update current index
        await User.findOneAndUpdate(
            { chatId },
            { 'claimSession.currentIndex': index }
        );
        
        // Send progress update
        const progressMsg = await getProgressMessage(chatId, index, links.length);
        await bot.sendMessage(chatId, progressMsg, {
            parse_mode: 'Markdown',
            ...getProgressKeyboard(chatId)
        });
        
        // Claim the link
        try {
            const result = await claimSingleLink(chatId, link);
            
            if (result.success) {
                // Update link status
                await Link.findByIdAndUpdate(link._id, {
                    status: 'claimed',
                    amount: result.amount || 4,
                    claimResult: result,
                    claimTime: new Date()
                });
                
                // Update user stats
                await User.findOneAndUpdate(
                    { chatId },
                    {
                        $inc: {
                            'claimSession.claimedLinks': 1,
                            'claimSession.totalAmount': result.amount || 4,
                            'stats.totalClaims': 1,
                            'stats.totalAmount': result.amount || 4
                        },
                        'stats.lastClaim': new Date()
                    }
                );
                
                // Increment selected/unselected
                if (result.amount > 0) {
                    await User.findOneAndUpdate(
                        { chatId },
                        { $inc: { 'claimSession.selectedCount': 1 } }
                    );
                } else {
                    await User.findOneAndUpdate(
                        { chatId },
                        { $inc: { 'claimSession.unselectedCount': 1 } }
                    );
                }
                
                await bot.sendMessage(chatId,
                    `✅ *Claim Successful!*

💰 Amount: ₹${result.amount || 4}
📊 Progress: ${index + 1}/${links.length}

Next claim in 30 seconds...`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Failed claim
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
                        },
                        'stats.lastClaim': new Date()
                    }
                );
                
                await bot.sendMessage(chatId,
                    `❌ *Claim Failed*

⚠️ Error: ${result.error || 'Unknown error'}
📊 Progress: ${index + 1}/${links.length}

Next claim in 30 seconds...`,
                    { parse_mode: 'Markdown' }
                );
            }
            
        } catch (error) {
            console.error('Error claiming link:', error);
            
            await Link.findByIdAndUpdate(link._id, {
                status: 'failed',
                error: error.message,
                claimTime: new Date()
            });
            
            await User.findOneAndUpdate(
                { chatId },
                { $inc: { 'claimSession.failedLinks': 1 } }
            );
        }
        
        // Schedule next claim after 30 seconds
        setTimeout(() => {
            processNextLink(chatId, index + 1);
        }, 30000);
        
    } catch (error) {
        console.error('Error in processNextLink:', error);
    }
}

// Claim single link
async function claimSingleLink(chatId, link) {
    try {
        const user = await User.findOne({ chatId });
        
        // Prepare claim payload
        const payload = {
            action: "claimlifafa",
            lid: link.lifafaId || 'default',
            number: user.phoneNumber,
            accessCode: "",
            referid: link.referId || '',
            selected: ""
        };
        
        // Encrypt payload
        const encryptedPayload = encryptPayload(payload);
        
        const formData = new FormData();
        formData.append('data', encryptedPayload);
        
        // Make claim request to lifafa handler
        const response = await axios.post('https://your-lifafa-site.com/handler', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        if (response.data.status === "success") {
            const isSuccess = response.data.claim_status !== "tried";
            const amount = isSuccess ? (response.data.perUser || 4) : 0;
            
            return {
                success: isSuccess,
                amount: amount,
                message: response.data.message,
                desc: response.data.desc,
                data: response.data
            };
        } else {
            return {
                success: false,
                error: response.data.message || 'Claim failed'
            };
        }
    } catch (error) {
        console.error('Claim error:', error);
        return {
            success: false,
            error: error.message || 'Network error'
        };
    }
}

// Get progress message
async function getProgressMessage(chatId, currentIndex, total) {
    const user = await User.findOne({ chatId });
    const links = await Link.find({ chatId });
    
    const claimed = links.filter(l => l.status === 'claimed').length;
    const failed = links.filter(l => l.status === 'failed').length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    const selected = links.filter(l => l.amount > 0).length;
    const unselected = links.filter(l => l.amount === 0 && l.status !== 'pending').length;
    
    const progressPercent = ((currentIndex) / total) * 100;
    const progressBar = createProgressBar(progressPercent);
    
    return `🔄 *Claim Progress*

${progressBar} ${Math.round(progressPercent)}%
${currentIndex}/${total} processed

*Current Stats:*
• ✅ Selected: ${selected}
• ❌ Unselected: ${unselected}
• 💰 Total: ₹${totalAmount}
• ⏳ Remaining: ${total - currentIndex}

Now claiming link ${currentIndex + 1}...`;
}

// Get final stats
async function getFinalStats(chatId) {
    const links = await Link.find({ chatId });
    
    const claimed = links.filter(l => l.status === 'claimed').length;
    const failed = links.filter(l => l.status === 'failed').length;
    const totalAmount = links.reduce((sum, l) => sum + (l.amount || 0), 0);
    const selected = links.filter(l => l.amount > 0).length;
    const unselected = links.filter(l => l.amount === 0 && l.status !== 'pending').length;
    
    return `📊 *Final Results*

• Total Links: ${links.length}
• ✅ Claimed: ${claimed}
• ❌ Failed: ${failed}
• 🎯 Selected: ${selected}
• ❌ Unselected: ${unselected}
• 💰 Total Amount: ₹${totalAmount}
• 📈 Success Rate: ${Math.round((claimed/links.length)*100)}%
• 💵 Average: ${claimed > 0 ? Math.round(totalAmount/claimed) : 0}`;
}

// Pause claim
async function pauseClaim(chatId) {
    await User.findOneAndUpdate(
        { chatId },
        { 'claimSession.active': false }
    );
    
    bot.sendMessage(chatId,
        '⏸️ *Claim Process Paused*\n\nClick "Start Claim" to resume.',
        { parse_mode: 'Markdown', ...mainMenu }
    );
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Express route for health check
app.get('/', (req, res) => {
    res.send('🤖 Lifafa Bot is Running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

console.log('🤖 Telegram Bot Started...');
