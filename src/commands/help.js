const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with Voice Monitor commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📚 GW2 Eternal VAT Help')
            .setDescription('Track voice channel activity for GW2 Eternal guild\n\u200B')
            .setColor(0x00FF88)
            .setTimestamp()
            .addFields(
                {
                    name: '⚙️ __Setup Command__',
                    value: '`/setup` - Configure all bot settings\n' +
                           '• Set tracking role\n' +
                           '• Configure report recipients\n' +
                           '• Set command permissions\n' +
                           '• Enable/disable weekly reports\n\n' +
                           '💡 **Tip:** Not all fields are required - only fill what you need!',
                    inline: false
                },
                {
                    name: '\u200B',
                    value: '\u200B',
                    inline: false
                },
                {
                    name: '📋 __Config Command__',
                    value: '`/config` - View current settings or reset to defaults\n' +
                           '• Check your current configuration\n' +
                           '• Reset everything to default values',
                    inline: false
                },
                {
                    name: '\u200B',
                    value: '\u200B',
                    inline: false
                },
                {
                    name: '📊 __Report Command__',
                    value: '`/voicereport` - Generate activity report\n' +
                           '• Choose from 7, 14, 21, or 30 day reports\n' +
                           '• Automatically sent to configured recipients',
                    inline: false
                },
                {
                    name: '\u200B',
                    value: '\u200B',
                    inline: false
                },
            )
            .setFooter({ text: 'GW2 Eternal • Voice Activity Tracking' });
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};