process.env.NODE_ENV = 'test';

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterAll(() => {
    jest.restoreAllMocks();
});

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/voice_monitor_test';
process.env.DISCORD_TOKEN = 'test-token';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

const Redis = require('ioredis-mock');
global.testRedis = new Redis();

global.testUtils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    createMockEmbed: () => ({
        data: {
            title: '',
            description: '',
            color: 0,
            fields: [],
            timestamp: new Date().toISOString()
        }
    }),
    
    expectEmbed: (interaction, title) => {
        const calls = interaction.reply.mock.calls.concat(
            interaction.editReply.mock.calls
        );
        
        const hasEmbed = calls.some(call => {
            const arg = call[0];
            return arg.embeds && arg.embeds.some(embed => 
                embed.data.title.includes(title)
            );
        });
        
        expect(hasEmbed).toBe(true);
    }
};