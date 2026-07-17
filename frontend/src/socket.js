import { io } from 'socket.io-client';

let socket = null;

/** Shared socket.io connection (JWT handshake, auto-reconnect). */
export function getSocket() {
  if (!socket) {
    socket = io('/', {
      path: '/api/socket.io',
      auth: { token: localStorage.getItem('token') },
      reconnectionDelayMax: 10000,
    });
    // pick up rotated tokens between reconnect attempts
    socket.on('reconnect_attempt', () => {
      socket.auth = { token: localStorage.getItem('token') };
    });
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
