const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devbackup')
        .setDescription('Developer: Backup management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('trigger')
                .setDescription('Manually trigger a backup'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restore')
                .setDescription('Restore from backup file')
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('Backup JSON file')
                        .setRequired(true)))
        .setDMPermission(false),
    
    isDev: true,
    
    async execute(interaction, client) {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('This command is restricted to the bot developer.')
                .setColor(0xFF0000)
                .setTimestamp();
                
            return interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'trigger') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                await client.backupHandler.performBackup();
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Backup Complete')
                    .setDescription('Manual backup has been completed successfully!')
                    .setColor(0x00FF88)
                    .setTimestamp()
                    .addFields({
                        name: '📅 Next Scheduled',
                        value: 'Daily at 3 AM UTC'
                    });
                    
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Backup Failed')
                    .setDescription('An error occurred during the backup process.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '🔧 Action Required',
                        value: 'Check the bot logs for detailed error information.'
                    });
                    
                await interaction.editReply({ embeds: [embed] });
            }
        } else if (subcommand === 'restore') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const attachment = interaction.options.getAttachment('file');
            
            if (!attachment.name.endsWith('.json')) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Invalid File Type')
                    .setDescription('Please upload a JSON backup file.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '📁 Expected Format',
                        value: 'Backup files must be in JSON format (`.json` extension)'
                    });
                    
                return interaction.editReply({ embeds: [embed] });
            }

            try {
                const response = await fetch(attachment.url);
                const fileContent = await response.text();
                
                const result = await client.backupHandler.restoreBackup(fileContent);
                
                if (result.success) {
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Restore Complete')
                        .setDescription('Backup data has been successfully restored!')
                        .setColor(0x00FF88)
                        .setTimestamp()
                        .addFields(
                            {
                                name: '📊 Sessions Restored',
                                value: `${result.restoredCount} voice sessions`,
                                inline: true
                            },
                            {
                                name: '📁 Source File',
                                value: attachment.name,
                                inline: true
                            }
                        );
                        
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('❌ Restore Failed')
                        .setDescription('Failed to restore backup data.')
                        .setColor(0xFF0000)
                        .setTimestamp()
                        .addFields({
                            name: '⚠️ Error Details',
                            value: `\`\`\`${result.error}\`\`\``
                        });
                        
                    await interaction.editReply({ embeds: [embed] });
                }
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Processing Error')
                    .setDescription('Failed to process the backup file.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .addFields({
                        name: '🔧 Troubleshooting',
                        value: '• Ensure the file is a valid backup JSON\n• Check that the file is not corrupted\n• Verify the file size is under Discord limits'
                    });
                    
                await interaction.editReply({ embeds: [embed] });
            }
        }
    }
};