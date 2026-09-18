const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const rooms = new Map();
const pairs = [
  ['Apple', 'Pear'], ['Cat', 'Dog'], ['Beach', 'Desert'], ['Coffee', 'Tea'],
  ['Moon', 'Sun'], ['Doctor', 'Nurse'], ['Train', 'Bus'], ['Pizza', 'Burger'],
  ['Rain', 'Snow'], ['King', 'Queen']
];

function code() {
  let c;
  do c = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(c));
  return c;
}

function publicState(r) {
  return {
    code: r.code,
    host: r.host,
    started: r.started,
    voting: r.voting,
    gameOver: r.gameOver,
    round: r.round,
    players: [...r.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      hasWord: !!p.word,
      eliminated: p.eliminated,
      voted: r.voting ? r.votes.has(p.id) : false
    }))
  };
}

function emitState(r) {
  io.to(r.code).emit('state', publicState(r));
}

function activePlayers(r) {
  return [...r.players.values()].filter(p => !p.eliminated);
}

function clearRoundVotes(r) {
  r.votes = new Map();
}

function startVoting(r) {
  r.voting = true;
  clearRoundVotes(r);
  emitState(r);
  io.to(r.code).emit('votingStarted');
}

function resolveVotes(r) {
  const counts = new Map();
  for (const targetId of r.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }

  const max = Math.max(...counts.values());
  const leaders = [...counts.entries()]
    .filter(([, count]) => count === max)
    .map(([id]) => id);

  if (leaders.length > 1) {
    const tiedNames = leaders.map(id => r.players.get(id)?.name || 'Unknown');
    r.round += 1;
    startVoting(r);
    io.to(r.code).emit('voteResult', {
      type: 'tie',
      message: `It is a tie between ${tiedNames.join(', ')}. A new voting round has started!`,
      leaders: tiedNames
    });
    return;
  }

  const removedId = leaders[0];
  const removed = r.players.get(removedId);
  if (!removed) return;

  removed.eliminated = true;
  r.voting = false;
  clearRoundVotes(r);

  const wasImposter = removed.role === 'imposter';
  r.gameOver = wasImposter;
  emitState(r);
  io.to(r.code).emit('voteResult', {
    type: wasImposter ? 'imposter' : 'villager',
    name: removed.name,
    message: wasImposter
      ? `Imposter removed: ${removed.name} 🎉`
      : `Villager removed: ${removed.name}`
  });
};

io.on('connection', socket => {
  socket.on('create', ({ name }) => {
    const c = code();
    const r = {
      code: c,
      host: socket.id,
      started: false,
      voting: false,
      gameOver: false,
      round: 0,
      players: new Map(),
      votes: new Map()
    };
    r.players.set(socket.id, {
      id: socket.id,
      name: (name || 'Player').trim().slice(0, 30),
      word: null,
      role: null,
      eliminated: false
    });
    rooms.set(c, r);
    socket.join(c);
    socket.data.room = c;
    socket.emit('joined', { ...publicState(r), you: socket.id });
    emitState(r);
  });

  socket.on('join', ({ code: rawCode, name }) => {
    const r = rooms.get((rawCode || '').toUpperCase());
    if (!r) return socket.emit('errorMsg', 'Room not found');
    if (r.started) return socket.emit('errorMsg', 'The game has already started');

    r.players.set(socket.id, {
      id: socket.id,
      name: (name || 'Player').trim().slice(0, 30),
      word: null,
      role: null,
      eliminated: false
    });
    socket.join(r.code);
    socket.data.room = r.code;
    socket.emit('joined', { ...publicState(r), you: socket.id });
    emitState(r);
  });

  socket.on('start', () => {
    const r = rooms.get(socket.data.room);
    if (!r || r.host !== socket.id) return socket.emit('errorMsg', 'Only the host can start the game');
    if (r.players.size < 3) return socket.emit('errorMsg', 'At least 3 players are required');

    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const players = [...r.players.values()];
    const imposterIndex = Math.floor(Math.random() * players.length);

    players.forEach((p, i) => {
      p.role = i === imposterIndex ? 'imposter' : 'player';
      p.word = i === imposterIndex ? pair[1] : pair[0];
      p.eliminated = false;
    });

    r.started = true;
    r.gameOver = false;
    r.voting = false;
    r.round = 1;
    clearRoundVotes(r);
    emitState(r);
    players.forEach(p => io.to(p.id).emit('privateWord', { word: p.word, role: p.role }));
  });

  socket.on('startVoting', () => {
    const r = rooms.get(socket.data.room);
    if (!r || r.host !== socket.id) return socket.emit('errorMsg', 'Only the host can start voting');
    if (!r.started || r.gameOver) return socket.emit('errorMsg', 'The game is not active');
    if (r.voting) return;
    if (activePlayers(r).length <= 2) return socket.emit('errorMsg', 'Not enough active players to vote');
    startVoting(r);
  });

  socket.on('vote', targetId => {
    const r = rooms.get(socket.data.room);
    if (!r || !r.voting || r.gameOver) return socket.emit('errorMsg', 'Voting is not active');
    const voter = r.players.get(socket.id);
    const target = r.players.get(targetId);
    if (!voter || voter.eliminated) return socket.emit('errorMsg', 'Eliminated players cannot vote');
    if (!target || target.eliminated) return socket.emit('errorMsg', 'Choose an active player');
    if (r.votes.has(socket.id)) return socket.emit('errorMsg', 'You have already voted');

    r.votes.set(socket.id, targetId);
    emitState(r);

    if (r.votes.size === activePlayers(r).length) resolveVotes(r);
  });

  socket.on('reset', () => {
    const r = rooms.get(socket.data.room);
    if (!r || r.host !== socket.id) return;
    r.started = false;
    r.voting = false;
    r.gameOver = false;
    r.round = 0;
    clearRoundVotes(r);
    r.players.forEach(p => {
      p.word = null;
      p.role = null;
      p.eliminated = false;
    });
    emitState(r);
    io.to(r.code).emit('resetClient');
  });

  socket.on('nextVotingRound', () => {
    const r = rooms.get(socket.data.room);
    if (!r || r.host !== socket.id || r.gameOver) return;
    r.round += 1;
    startVoting(r);
  });

  socket.on('disconnect', () => {
    const r = rooms.get(socket.data.room);
    if (!r) return;
    r.players.delete(socket.id);
    r.votes.delete(socket.id);
    if (!r.players.size) rooms.delete(r.code);
    else {
      if (r.host === socket.id) r.host = [...r.players.keys()][0];
      emitState(r);
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Running on port ${port}`));
