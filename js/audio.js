// Ambiance sonore déclenchée par le MJ : une musique en boucle + des effets ponctuels.
// Utilisé par la vue joueur, la vue spectateur (stream) et la vue MJ (écoute locale).

export class AmbiencePlayer {
    /** resolveSrc(src) → Promise<URL lisible> (les fichiers importés sont récupérés auprès du MJ). */
    constructor(resolveSrc = async (s) => s) {
        this.resolve = resolveSrc;
        this.music = new Audio();
        this.music.loop = true;
        this.sfx = new Audio();
        this.musicTs = null;
        this.sfxTs = null;
        this.first = true;
        this.muted = false;
    }

    /** amb : { music: { ts, src, volume } | null, sfx: { ts, src, volume } | null } */
    async apply(amb) {
        const first = this.first;
        this.first = false;
        const m = amb?.music || null;
        if (!m) {
            if (this.musicTs) { this.music.pause(); this.musicTs = null; }
        } else {
            if (m.ts !== this.musicTs) {
                this.musicTs = m.ts;
                const src = await this.resolve(m.src);
                if (this.musicTs !== m.ts) return; // remplacé entre-temps
                this.music.src = src;
                this.music.currentTime = 0;
                this._play(this.music);
            }
            this.music.volume = clamp(m.volume);
        }
        const s = amb?.sfx || null;
        // À l'arrivée dans la session on ne rejoue pas un effet déjà passé.
        if (s && s.ts !== this.sfxTs) {
            this.sfxTs = s.ts;
            if (!first && Date.now() - s.ts < 15000) {
                const src = await this.resolve(s.src);
                this.sfx.src = src;
                this.sfx.volume = clamp(s.volume);
                this._play(this.sfx);
            }
        }
    }

    setMuted(v) {
        this.muted = v;
        this.music.muted = v;
        this.sfx.muted = v;
    }

    _play(audio) {
        audio.muted = this.muted;
        audio.play().catch(() => showUnlock(() => audio.play().catch(() => {})));
    }

    stop() {
        this.music.pause();
        this.sfx.pause();
        this.music.removeAttribute('src');
        this.sfx.removeAttribute('src');
    }
}

const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));

// Les navigateurs bloquent parfois le son tant que l'utilisateur n'a pas cliqué.
function showUnlock(retry) {
    if (document.getElementById('audio-unlock')) return;
    const b = document.createElement('button');
    b.id = 'audio-unlock';
    b.className = 'btn';
    b.innerHTML = '<i class="fa-solid fa-volume-high"></i> Activer le son de l\'ambiance';
    b.onclick = () => { b.remove(); retry(); };
    document.body.appendChild(b);
}
