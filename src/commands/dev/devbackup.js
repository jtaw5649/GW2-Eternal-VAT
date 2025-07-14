const { SlashCommandBuilder, MessageFlags } = require('discord.js');

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
            return interaction.reply({ 
                content: 'This command is restricted to the bot developer.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'trigger') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                await client.backupHandler.performBackup();
                await interaction.editReply('✅ Backup completed successfully!');
            } catch (error) {
                await interaction.editReply('❌ Backup failed. Check logs for details.');
            }
        } else if (subcommand === 'restore') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const attachment = interaction.options.getAttachment('file');
            
            if (!attachment.name.endsWith('.json')) {
                return interaction.editReply('❌ Please upload a JSON backup file.');
            }

            try {
                const response = await fetch(attachment.url);
                const fileContent = await response.text();
                
                const result = await client.backupHandler.restoreBackup(fileContent);
                
                if (result.success) {
                    await interaction.editReply(`✅ Restored ${result.restoredCount} voice sessions from backup.`);
                } else {
                    await interaction.editReply(`❌ Restore failed: ${result.error}`);
                }
            } catch (error) {
                await interaction.editReply('❌ Failed to process backup file.');
            }
        }
    }
};