const { createTestInteraction } = require('../../setup');
const voicereportCommand = require('../../../src/commands/voicereport');

describe('VoiceReport Command', () => {
    let interaction;
    let client;
    
    beforeEach(() => {
        interaction = createTestInteraction('voicereport', { integer: 7 });
        interaction.options.getInteger.mockReturnValue(7);
        
        client = {
            configManager: {
                getServerConfig: jest.fn()
            },
            generateAndSendReport: jest.fn()
        };
    });
    
    test('generates report with correct days', async () => {
        client.configManager.getServerConfig.mockResolvedValue({
            commandRoleId: null,
            reportChannelId: null
        });
        
        interaction.member.permissions = { has: jest.fn().mockReturnValue(true) };
        
        await voicereportCommand.execute(interaction, client);
        
        expect(client.generateAndSendReport).toHaveBeenCalledWith('1234567890', 7);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('7-day')
            })
        );
    });
    
    test('denies access without permissions', async () => {
        client.configManager.getServerConfig.mockResolvedValue({
            commandRoleId: '777'
        });
        
        interaction.member.permissions = { has: jest.fn().mockReturnValue(false) };
        interaction.member.roles.cache = new Map();
        
        await voicereportCommand.execute(interaction, client);
        
        expect(client.generateAndSendReport).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('do not have permission')
            })
        );
    });
    
    test('enforces channel restriction', async () => {
        client.configManager.getServerConfig.mockResolvedValue({
            reportChannelId: '555'
        });
        
        interaction.channelId = '444';
        interaction.member.permissions = { has: jest.fn().mockReturnValue(true) };
        
        await voicereportCommand.execute(interaction, client);
        
        expect(client.generateAndSendReport).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('can only be used in')
            })
        );
    });
});
