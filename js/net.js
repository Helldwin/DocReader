// Couche réseau temps réel en pair-à-pair (WebRTC via PeerJS, global `Peer`).
// Le MJ est l'hôte : son navigateur détient l'état et l'envoie aux joueurs.
// Aucun serveur à maintenir : seul le "courtier" public PeerJS sert à la mise en relation.
import { CONFIG } from './config.js';

const HEARTBEAT_MS = 4000;
const TIMEOUT_MS = 16000;

export class Host {
    /** handlers : { onHello(clientId, msg), onMessage(clientId, msg), onLeave(clientId), onStatus(status, detail) } */
    constructor(code, handlers) {
        this.code = code;
        this.h = handlers;
        this.clients = new Map(); // clientId -> { conn, name, lastSeen }
        this.destroyed = false;
        this.attempt = 0;
    }

    start() {
        if (this.destroyed) return;
        this.h.onStatus?.('connecting');
        const peer = new Peer(CONFIG.PEER_PREFIX + this.code, CONFIG.PEER_OPTIONS);
        this.peer = peer;
        peer.on('open', () => { this.attempt = 0; this.h.onStatus?.('online'); });
        peer.on('connection', (conn) => this._accept(conn));
        peer.on('disconnected', () => {
            if (this.destroyed || peer.destroyed) return;
            this.h.onStatus?.('reconnecting');
            setTimeout(() => { if (!this.destroyed && !peer.destroyed) peer.reconnect(); }, 1500);
        });
        peer.on('error', (err) => {
            if (this.destroyed) return;
            if (err.type === 'unavailable-id') {
                // Typiquement : l'onglet précédent (crash / F5) détient encore l'ID quelques secondes.
                this.h.onStatus?.('id-taken');
                this._restart(4000);
            } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
                this.h.onStatus?.('reconnecting', err.type);
                this._restart(5000);
            } else {
                console.warn('[IRIS host]', err.type, err);
            }
        });
        clearInterval(this.hb);
        this.hb = setInterval(() => this._sweep(), HEARTBEAT_MS);
    }

    _restart(delay) {
        try { this.peer?.destroy(); } catch { /* ignore */ }
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.start(), delay * Math.min(3, 1 + this.attempt++ * 0.5));
    }

    _accept(conn) {
        conn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (!conn._clientId) {
                if (msg.t !== 'hello' || !msg.clientId) return;
                const id = String(msg.clientId).replace(/[^\w-]/g, '').slice(0, 48);
                if (!id) return;
                const prev = this.clients.get(id);
                if (prev && prev.conn !== conn) { try { prev.conn.close(); } catch { /* ignore */ } }
                conn._clientId = id;
                this.clients.set(id, { conn, name: String(msg.name || 'Joueur').slice(0, 40), role: msg.role === 'spectator' ? 'spectator' : 'player', lastSeen: Date.now() });
                this.h.onHello?.(id, msg);
                return;
            }
            const c = this.clients.get(conn._clientId);
            if (c) c.lastSeen = Date.now();
            if (msg.t === 'ping') { this._raw(conn, { t: 'pong' }); return; }
            this.h.onMessage?.(conn._clientId, msg);
        });
        const gone = () => {
            const id = conn._clientId;
            if (id && this.clients.get(id)?.conn === conn) {
                this.clients.delete(id);
                this.h.onLeave?.(id);
            }
        };
        conn.on('close', gone);
        conn.on('error', gone);
    }

    _sweep() {
        const now = Date.now();
        for (const [id, c] of this.clients) {
            if (now - c.lastSeen > TIMEOUT_MS) {
                try { c.conn.close(); } catch { /* ignore */ }
                this.clients.delete(id);
                this.h.onLeave?.(id);
            }
        }
    }

    _raw(conn, msg) {
        try { if (conn.open) conn.send(msg); } catch (e) { console.warn('[IRIS host] envoi impossible', e); }
    }

    send(clientId, msg) {
        const c = this.clients.get(clientId);
        if (c) this._raw(c.conn, msg);
    }

    get clientIds() { return [...this.clients.keys()]; }

    stop() {
        this.destroyed = true;
        clearInterval(this.hb);
        clearTimeout(this.restartTimer);
        for (const c of this.clients.values()) { try { c.conn.close(); } catch { /* ignore */ } }
        this.clients.clear();
        try { this.peer?.destroy(); } catch { /* ignore */ }
    }
}

export class Client {
    /** handlers : { onMessage(msg), onStatus(status) } — status ∈ connecting|connected|not-found|lost|error */
    constructor(code, hello, handlers) {
        this.code = code;
        this.hello = hello;
        this.h = handlers;
        this.destroyed = false;
        this.lastSeen = 0;
    }

    start() {
        if (this.destroyed) return;
        this.h.onStatus?.('connecting');
        try { this.peer?.destroy(); } catch { /* ignore */ }
        const peer = new Peer(CONFIG.PEER_OPTIONS);
        this.peer = peer;
        peer.on('open', () => this._connect());
        peer.on('disconnected', () => { if (!this.destroyed && !peer.destroyed) peer.reconnect(); });
        peer.on('error', (err) => {
            if (this.destroyed) return;
            if (err.type === 'peer-unavailable') this.h.onStatus?.('not-found');
            else this.h.onStatus?.('error', err.type);
            this._retry(err.type === 'peer-unavailable' ? 3000 : 5000, err.type !== 'peer-unavailable');
        });
        clearInterval(this.hb);
        this.hb = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    }

    _connect() {
        if (this.destroyed) return;
        if (this.conn) { const old = this.conn; this.conn = null; try { old.close(); } catch { /* ignore */ } }
        const conn = this.peer.connect(CONFIG.PEER_PREFIX + this.code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => {
            this.lastSeen = Date.now();
            conn.send(this.hello);
            this.h.onStatus?.('connected');
        });
        conn.on('data', (msg) => {
            this.lastSeen = Date.now();
            if (msg?.t === 'pong') return;
            this.h.onMessage?.(msg);
        });
        const lost = () => {
            if (this.conn !== conn || this.destroyed) return;
            this.conn = null;
            this.h.onStatus?.('lost');
            this._retry(2500);
        };
        conn.on('close', lost);
        conn.on('error', lost);
    }

    _retry(delay, fullRestart = false) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            if (this.destroyed) return;
            if (fullRestart || !this.peer || this.peer.destroyed) return this.start();
            if (this.peer.disconnected) { this.peer.reconnect(); setTimeout(() => this._connect(), 1500); return; }
            this._connect();
        }, delay);
    }

    _heartbeat() {
        const conn = this.conn;
        if (!conn) return;
        if (conn.open) {
            try { conn.send({ t: 'ping' }); } catch { /* ignore */ }
            if (Date.now() - this.lastSeen > TIMEOUT_MS) { try { conn.close(); } catch { /* ignore */ } this.conn = null; this.h.onStatus?.('lost'); this._retry(500); }
        } else if (this.lastSeen && Date.now() - this.lastSeen > TIMEOUT_MS * 2) {
            this.conn = null;
            this._retry(500);
        }
    }

    send(msg) {
        try { if (this.conn?.open) { this.conn.send(msg); return true; } } catch (e) { console.warn(e); }
        return false;
    }

    stop() {
        this.destroyed = true;
        clearInterval(this.hb);
        clearTimeout(this.retryTimer);
        try { this.conn?.close(); } catch { /* ignore */ }
        try { this.peer?.destroy(); } catch { /* ignore */ }
    }
}
