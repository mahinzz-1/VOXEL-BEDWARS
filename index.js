const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 19130;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('BedWars Game Server Running');
});

const wss = new WebSocketServer({ server });

const players = {};
const world = {};
let redBedAlive = true;
let blueBedAlive = true;

function initWorld() {
    for (let x = -5; x <= 5; x++) {
        for (let z = -35; z <= -25; z++) {
            world[`${x},4,${z}`] = 'stone';
            if (Math.abs(x) === 5 || z === -35 || z === -25) {
                world[`${x},5,${z}`] = 'wood';
                world[`${x},6,${z}`] = 'wood';
            }
        }
    }
    world[`0,5,-33`] = 'wood';
    world[`0,5,-34`] = 'wood';

    for (let x = -5; x <= 5; x++) {
        for (let z = 25; z <= 35; z++) {
            world[`${x},4,${z}`] = 'stone';
            if (Math.abs(x) === 5 || z === 25 || z === 35) {
                world[`${x},5,${z}`] = 'wood';
                world[`${x},6,${z}`] = 'wood';
            }
        }
    }
    world[`0,5,33`] = 'wood';
    world[`0,5,34`] = 'wood';

    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            const dist = Math.hypot(x, z);
            if (dist <= 5.2) {
                world[`${x},2,${z}`] = 'stone';
                if (dist > 4.0) {
                    world[`${x},3,${z}`] = 'grass';
                    world[`${x},4,${z}`] = 'grass';
                }
            }
        }
    }
}
initWorld();

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            switch (packet.type) {
                case 'BedWarsJoin':
                    const redCount = Object.values(players).filter(p => p.team === 'red').length;
                    const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
                    const team = redCount <= blueCount ? 'red' : 'blue';
                    const spawnZ = team === 'red' ? 30 : -30;

                    players[playerId] = { 
                        x: 0.5, 
                        y: 16.61, 
                        z: spawnZ + 0.5, 
                        yaw: 0, 
                        pitch: 0, 
                        activeBlock: 'stone',
                        name: packet.name,
                        team: team,
                        health: 20
                    };

                    ws.send(JSON.stringify({
                        type: 'PlayerJoin',
                        id: playerId,
                        world: world,
                        team: team,
                        players: Object.keys(players).map(id => ({ id, ...players[id] }))
                    }));

                    broadcast({
                        type: 'PlayerJoin',
                        id: playerId,
                        state: players[playerId]
                    }, playerId);

                    broadcast({
                        type: 'PlayerName',
                        id: playerId,
                        name: packet.name
                    });
                    break;

                case 'PlayerPosition':
                    if (players[playerId]) {
                        players[playerId].x = packet.x;
                        players[playerId].y = packet.y;
                        players[playerId].z = packet.z;
                        players[playerId].yaw = packet.yaw;
                        players[playerId].pitch = packet.pitch;
                    }
                    break;

                case 'PlayerJump':
                    broadcast({ type: 'PlayerJump', id: playerId }, playerId);
                    break;

                case 'PlayerPlaceBlock':
                    world[`${packet.x},${packet.y},${packet.z}`] = packet.blockType;
                    broadcast({
                        type: 'PlayerPlaceBlock',
                        x: packet.x,
                        y: packet.y,
                        z: packet.z,
                        blockType: packet.blockType
                    });
                    break;

                case 'PlayerBreakBlock':
                    const bx = packet.x;
                    const by = packet.y;
                    const bz = packet.z;
                    delete world[`${bx},${by},${bz}`];
                    broadcast({ type: 'PlayerBreakBlock', x: bx, y: by, z: bz });

                    if (by === 5) {
                        if (bx === 0 && (bz === -33 || bz === -34)) {
                            if (blueBedAlive) {
                                blueBedAlive = false;
                                broadcast({ type: 'PlayerNotify', message: 'Blue Bed has been destroyed!' });
                            }
                        } else if (bx === 0 && (bz === 33 || bz === 34)) {
                            if (redBedAlive) {
                                redBedAlive = false;
                                broadcast({ type: 'PlayerNotify', message: 'Red Bed has been destroyed!' });
                            }
                        }
                    }
                    break;

                case 'PlayerInventory':
                    if (players[playerId]) {
                        players[playerId].activeBlock = packet.activeBlock;
                    }
                    break;

                case 'PlayerSendMessage':
                    if (players[playerId]) {
                        broadcast({
                            type: 'PlayerSendMessage',
                            id: playerId,
                            name: players[playerId].name,
                            message: packet.message
                        });
                    }
                    break;

                case 'PlayerHit':
                    const attacker = players[playerId];
                    const target = players[packet.targetId];
                    if (attacker && target) {
                        target.health -= 4;
                        if (target.health <= 0) {
                            target.health = 20;
                            const isBedAlive = target.team === 'red' ? redBedAlive : blueBedAlive;
                            const respawnZ = target.team === 'red' ? 30 : -30;
                            if (isBedAlive) {
                                target.x = 0.5;
                                target.y = 16.61;
                                target.z = respawnZ + 0.5;
                                broadcast({
                                    type: 'PlayerRespawn',
                                    id: packet.targetId,
                                    x: 0.5,
                                    y: 16.61,
                                    z: respawnZ + 0.5,
                                    spectator: false
                                });
                            } else {
                                broadcast({
                                    type: 'PlayerRespawn',
                                    id: packet.targetId,
                                    x: 0.5,
                                    y: 30,
                                    z: 0.5,
                                    spectator: true
                                });
                            }
                            broadcast({
                                type: 'PlayerNotify',
                                message: `${attacker.name} killed ${target.name}!`
                            });
                        } else {
                            broadcast({
                                type: 'PlayerHealth',
                                id: packet.targetId,
                                health: target.health
                            });
                        }
                        broadcast({
                            type: 'PlayerHit',
                            attackerId: playerId,
                            targetId: packet.targetId
                        });
                    }
                    break;

                case 'PlayerRespawn':
                    if (players[playerId]) {
                        const myTeam = players[playerId].team;
                        const isBedAlive = myTeam === 'red' ? redBedAlive : blueBedAlive;
                        if (isBedAlive) {
                            const respawnZ = myTeam === 'red' ? 30 : -30;
                            players[playerId].x = 0.5;
                            players[playerId].y = 16.61;
                            players[playerId].z = respawnZ + 0.5;
                            ws.send(JSON.stringify({
                                type: 'PlayerRespawn',
                                id: playerId,
                                x: 0.5,
                                y: 16.61,
                                z: respawnZ + 0.5,
                                spectator: false
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                type: 'PlayerRespawn',
                                id: playerId,
                                x: 0.5,
                                y: 30,
                                z: 0.5,
                                spectator: true
                            }));
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
        broadcast({ type: 'leave', id: playerId });
    });
});

function broadcast(data, excludeId = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

setInterval(() => {
    const tickData = {
        type: 'Tick',
        players: Object.keys(players).map(id => ({ id, ...players[id] }))
    };
    broadcast(tickData);
}, 50);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`BedWars Game Server running on port ${PORT}`);
});
