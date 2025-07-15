const VoiceMonitorBot = require('./core/VoiceMonitorBot');

if (require.main === module) {
    const bot = new VoiceMonitorBot();
    
    process.on('SIGINT', () => bot.shutdown());
    process.on('SIGTERM', () => bot.shutdown());
    
    bot.start().catch(console.error);
}

module.exports = VoiceMonitorBot;