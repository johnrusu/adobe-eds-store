/**
 * WSL mirrored networking often leaves TCP connects to unbound localhost
 * ports hanging instead of returning ECONNREFUSED. @adobe/aem-cli's
 * checkPortInUse has no timeout, so `aem up` stalls after the banner.
 * This preload forces a refused-connect error after a short wait.
 */
const net = require('net');

const TIMEOUT_MS = 400;
const origConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function patchedConnect(...args) {
  const socket = this;
  let settled = false;

  const markSettled = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    if (settled || socket.destroyed) return;
    settled = true;
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    socket.destroy(err);
  }, TIMEOUT_MS);

  socket.once('connect', markSettled);
  socket.once('error', markSettled);

  return origConnect.apply(this, args);
};
