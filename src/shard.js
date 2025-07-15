const { ShardingManager } = require('discord.js');
const Redis = require('ioredis');
const path = require('path');

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});

const manager = new ShardingManager(path.join(__dirname, 'bot.js'), {
    token: process.env.DISCORD_TOKEN,
    totalShards: process.env.TOTAL_SHARDS || 'auto',
    respawn: true,
    shardArgs: process.argv.slice(2),
    execArgv: ['--trace-warnings']
});

manager.on('shardCreate', shard => {
    console.log(`[ShardManager] Launched shard ${shard.id}`);
    
    shard.on('ready', () => {
        console.log(`[Shard ${shard.id}] Ready`);
        updateShardStatus(shard.id, 'ready');
    });
    
    shard.on('disconnect', () => {
        console.log(`[Shard ${shard.id}] Disconnected`);
        updateShardStatus(shard.id, 'disconnected');
    });
    
    shard.on('reconnecting', () => {
        console.log(`[Shard ${shard.id}] Reconnecting`);
        updateShardStatus(shard.id, 'reconnecting');
    });
    
    shard.on('death', process => {
        console.error(`[Shard ${shard.id}] Process died (${process.exitCode})`);
        updateShardStatus(shard.id, 'dead');
    });
    
    shard.on('error', error => {
        console.error(`[Shard ${shard.id}] Error:`, error);
    });
});

async function updateShardStatus(shardId, status) {
    try {
        await redis.hset('shard:status', shardId.toString(), JSON.stringify({
            status,
            timestamp: Date.now(),
            pid: process.pid
        }));
    } catch (error) {
        console.error('Failed to update shard status:', error);
    }
}

setInterval(async () => {
    try {
        const results = await manager.broadcastEval(client => ({
            shardId: client.shard?.ids[0],
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            uptime: client.uptime,
            ping: client.ws.ping,
            memoryUsage: process.memoryUsage().heapUsed
        }));
        
        console.log('[ShardManager] Health check:', results);
        
        const totalGuilds = results.reduce((acc, res) => acc + res.guilds, 0);
        const totalUsers = results.reduce((acc, res) => acc + res.users, 0);
        const avgPing = results.reduce((acc, res) => acc + res.ping, 0) / results.length;
        
        await redis.hset('bot:stats', {
            totalGuilds: totalGuilds.toString(),
            totalUsers: totalUsers.toString(),
            avgPing: avgPing.toString(),
            shardCount: results.length.toString(),
            lastUpdate: Date.now().toString()
        });
    } catch (error) {
        console.error('[ShardManager] Health check failed:', error);
    }
}, 60000);

async function shutdown() {
    console.log('[ShardManager] Shutting down');
    
    await manager.broadcastEval(client => process.exit(0));
    
    setTimeout(() => {
        redis.disconnect();
        process.exit(0);
    }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

manager.spawn().then(() => {
    console.log(`[ShardManager] All shards spawned (${manager.totalShards} total)`);
}).catch(console.error);