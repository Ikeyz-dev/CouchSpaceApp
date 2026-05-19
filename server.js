const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── Static files ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── In-memory store ───────────────────────────────────────────────────
const rooms = new Map();   // roomId → Room
const users = new Map();   // socketId → User

const COLORS = [
  '#f0a500','#e05252','#52b0e0','#6ddb6d','#b07ce0',
  '#e0a052','#52e0c4','#e07cb0','#7ca0e0','#d4e052',
];

function uid() { return crypto.randomBytes(4).toString('hex'); }
function pickColor(usedColors) {
  return COLORS.find(c => !usedColors.includes(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
}

// ── Broadcast public room list ─────────────────────────────────────────
function broadcastRooms() {
  const list = publicRoomList();
  io.emit('rooms_updated', list);
}

function publicRoomList() {
  return [...rooms.values()]
    .filter(r => r.privacy === 'public')
    .map(roomSummary);
}

function roomSummary(r) {
  return {
    id: r.id,
    name: r.name,
    hostName: r.hostName,
    privacy: r.privacy,
    hasPassword: !!r.password,
    hostOnly: r.hostOnly,
    viewerCount: r.members.size,
  };
}

// ── Socket.io ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── GET ROOMS ──────────────────────────────────────────────────────
  socket.on('get_rooms', (cb) => {
    if (typeof cb === 'function') cb(publicRoomList());
  });

  // ── GET ROOM BY ID ─────────────────────────────────────────────────
  socket.on('get_room_by_id', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb(null);
    cb(roomSummary(room));
  });

  // ── CREATE ROOM ────────────────────────────────────────────────────
  socket.on('create_room', ({ name, roomName, privacy, password, hostOnly }, cb) => {
    if (!name?.trim()) return cb({ success: false, error: 'Name is required.' });
    if (!roomName?.trim()) return cb({ success: false, error: 'Room name is required.' });

    const roomId = uid();
    const usedColors = [];
    const color = pickColor(usedColors);

    const room = {
      id: roomId,
      name: roomName.trim(),
      hostId: socket.id,
      hostName: name.trim(),
      privacy: privacy || 'public',
      password: password?.trim() || '',
      hostOnly: !!hostOnly,
      members: new Map(),   // socketId → { name, color }
      videoState: { url: '', time: 0, isPlaying: false },
    };

    room.members.set(socket.id, { name: name.trim(), color });
    rooms.set(roomId, room);

    users.set(socket.id, { roomId, name: name.trim(), color });
    socket.join(roomId);

    broadcastRooms();
    cb({ success: true, color, room: roomSummary(room) });
    console.log(`[room created] ${roomId} "${roomName}" by ${name}`);
  });

  // ── JOIN ROOM ──────────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, name, password }, cb) => {
    if (!name?.trim()) return cb({ success: false, error: 'Name is required.' });

    const room = rooms.get(roomId);
    if (!room) return cb({ success: false, error: 'Room not found.' });
    if (room.password && room.password !== password?.trim())
      return cb({ success: false, error: 'Wrong password.' });

    // Pick a color not already in the room
    const usedColors = [...room.members.values()].map(m => m.color);
    const color = pickColor(usedColors);

    room.members.set(socket.id, { name: name.trim(), color });
    users.set(socket.id, { roomId, name: name.trim(), color });
    socket.join(roomId);

    // Tell existing members
    socket.to(roomId).emit('user_joined', { name: name.trim(), color, viewerCount: room.members.size });
    broadcastRooms();

    cb({
      success: true,
      color,
      room: roomSummary(room),
      videoState: room.videoState,
    });
    console.log(`[join] ${name} → room ${roomId}`);
  });

  // ── CHAT ───────────────────────────────────────────────────────────
  socket.on('chat_message', ({ text }) => {
    const user = users.get(socket.id);
    if (!user || !text?.trim()) return;
    io.to(user.roomId).emit('chat_message', { name: user.name, color: user.color, text: text.trim() });
  });

  // ── TYPING ────────────────────────────────────────────────────────
  socket.on('typing_start', () => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(user.roomId).emit('typing_start', { name: user.name });
  });
  socket.on('typing_stop', () => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(user.roomId).emit('typing_stop', { name: user.name });
  });

  // ── EMOJI ─────────────────────────────────────────────────────────
  socket.on('emoji_reaction', ({ emoji }) => {
    const user = users.get(socket.id);
    if (!user) return;
    io.to(user.roomId).emit('emoji_reaction', { name: user.name, color: user.color, emoji });
  });

  // ── VIDEO EVENTS ──────────────────────────────────────────────────
  function getRoom() {
    const user = users.get(socket.id);
    if (!user) return null;
    return rooms.get(user.roomId) || null;
  }

  function canControl(room) {
    if (!room.hostOnly) return true;
    return room.hostId === socket.id;
  }

  socket.on('video_load', ({ url }) => {
    const room = getRoom();
    if (!room || !canControl(room)) return;
    room.videoState = { url, time: 0, isPlaying: false };
    socket.to(room.id).emit('video_load', { url });
  });

  socket.on('video_play', ({ time }) => {
    const room = getRoom();
    if (!room || !canControl(room)) return;
    room.videoState.isPlaying = true;
    room.videoState.time = time;
    room.videoState.lastUpdate = Date.now();
    socket.to(room.id).emit('video_play', { time });
  });

  socket.on('video_pause', ({ time }) => {
    const room = getRoom();
    if (!room || !canControl(room)) return;
    room.videoState.isPlaying = false;
    room.videoState.time = time;
    room.videoState.lastUpdate = Date.now();
    socket.to(room.id).emit('video_pause', { time });
  });

  socket.on('video_seek', ({ time }) => {
    const room = getRoom();
    if (!room || !canControl(room)) return;
    room.videoState.time = time;
    room.videoState.lastUpdate = Date.now();
    socket.to(room.id).emit('video_seek', { time });
  });

  // ── HOST-ONLY TOGGLE ──────────────────────────────────────────────
  socket.on('set_host_only', ({ hostOnly }) => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id) return;
    room.hostOnly = !!hostOnly;
    io.to(room.id).emit('host_only_changed', { hostOnly: room.hostOnly });
    const msg = room.hostOnly ? '👑 Host-only controls enabled' : '👥 Everyone can now control playback';
    io.to(room.id).emit('system_message', { text: msg });
    broadcastRooms();
  });

  // ── DISCONNECT ────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const { roomId, name } = user;
    users.delete(socket.id);

    const room = rooms.get(roomId);
    if (!room) return;

    room.members.delete(socket.id);
    socket.to(roomId).emit('user_left', { name, viewerCount: room.members.size });

    if (room.members.size === 0) {
      // Empty room — clean up
      rooms.delete(roomId);
      broadcastRooms();
      console.log(`[room closed] ${roomId} — empty`);
      return;
    }

    // Hand off host if the host left
    if (room.hostId === socket.id) {
      const [newHostId, newHostUser] = room.members.entries().next().value;
      room.hostId = newHostId;
      room.hostName = newHostUser.name;
      io.to(roomId).emit('host_changed', { hostName: newHostUser.name });
      io.to(roomId).emit('system_message', { text: `👑 ${newHostUser.name} is now the host` });
      console.log(`[host transfer] ${roomId} → ${newHostUser.name}`);
    }

    broadcastRooms();
    console.log(`[disconnect] ${socket.id} (${name})`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CouchSpace running → http://localhost:${PORT}`));
