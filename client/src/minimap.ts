// Top-left minimap drawn from the real store geometry and the live snapshot.
import { COFFEE_MACHINE, COUNTER, CRATES, DECOR, MOP_RACK, SHELVES, STORE_D, STORE_W, WALLS, AABB, DOOR_X0, DOOR_X1 } from '../../shared/map.ts';
import { PRODUCT_INFO } from '../../shared/constants.ts';
import type { Snapshot } from '../../shared/protocol.ts';
import { palette } from './a11y.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class Minimap {
  private g: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private scale: number;
  private pad = 6;
  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    this.scale = Math.min((canvas.width - this.pad * 2) / STORE_W, (canvas.height - this.pad * 2) / STORE_D);
    this.bg = document.createElement('canvas');
    this.bg.width = canvas.width; this.bg.height = canvas.height;
    this.drawStatic();
  }
  private X(x: number) { return this.pad + x * this.scale; }
  private Z(z: number) { return this.pad + z * this.scale; }
  private rect(g: CanvasRenderingContext2D, b: AABB, color: string) { g.fillStyle = color; g.fillRect(this.X(b.x0), this.Z(b.z0), (b.x1 - b.x0) * this.scale, (b.z1 - b.z0) * this.scale); }

  private drawStatic() {
    const g = this.bg.getContext('2d')!;
    g.fillStyle = 'rgba(233,228,216,0.85)'; g.fillRect(this.X(0), this.Z(0), STORE_W * this.scale, STORE_D * this.scale);
    g.fillStyle = 'rgba(150,145,135,0.85)'; g.fillRect(this.X(0), this.Z(0), 6.6 * this.scale, 5 * this.scale);
    for (const w of WALLS) this.rect(g, w, '#3b3f55');
    for (const s of SHELVES) this.rect(g, s.box, hex(PRODUCT_INFO[s.product].color));
    for (const c of CRATES) this.rect(g, c.box, '#8d6e63');
    this.rect(g, COUNTER, '#8d6e63'); this.rect(g, COFFEE_MACHINE, '#343a40'); this.rect(g, MOP_RACK, '#74c0fc');
    for (const d of DECOR) this.rect(g, d, '#adb5bd');
    g.fillStyle = '#51cf66'; g.fillRect(this.X(DOOR_X0), this.Z(STORE_D) - 2, (DOOR_X1 - DOOR_X0) * this.scale, 4);
  }

  draw(s: Snapshot, selfId: string, self: { x: number; z: number; yaw: number }, time: number, guide: { x: number; z: number } | null = null) {
    const g = this.g;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.bg, 0, 0);
    // Every state has its own shape, not only a colour (色盲友善 swaps the colours on top of that):
    // spill = flat blot, dropped box = square, karen = big diamond with「!」, waiting for coffee/food = small square,
    // at the till = ringed dot, other customers = small dot; teammates = arrows, pings = solid ring, guide = dashed ring.
    const pal = palette();
    g.fillStyle = '#8a6d3b';
    for (const sp of s.spills) { g.beginPath(); g.ellipse(this.X(sp.x), this.Z(sp.z), 4, 2.2, 0, 0, Math.PI * 2); g.fill(); }
    for (const it of s.items) { g.fillStyle = '#c49a6c'; g.fillRect(this.X(it.x) - 2, this.Z(it.z) - 2, 4, 4); }
    // customers
    for (const c of s.customers) {
      const cx = this.X(c.x), cz = this.Z(c.z);
      if (c.kind !== 'normal' && !c.resolved && c.revealed) {
        const r = 5 + Math.sin(time * 8) * 1.2;
        g.fillStyle = pal.karen; g.beginPath(); g.moveTo(cx, cz - r); g.lineTo(cx + r, cz); g.lineTo(cx, cz + r); g.lineTo(cx - r, cz); g.closePath(); g.fill();
        g.strokeStyle = '#2a1f3d'; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText('!', cx, cz + 3);
      } else if (c.kind === 'hog' && !c.revealed) {
        continue;
      } else if (c.state === 'waitCoffee' || c.state === 'waitFood') {
        g.fillStyle = pal.wait; g.fillRect(cx - 2.4, cz - 2.4, 4.8, 4.8);
        g.strokeStyle = '#2a1f3d'; g.lineWidth = 0.8; g.strokeRect(cx - 2.4, cz - 2.4, 4.8, 4.8);
      } else if (c.state === 'atRegister') {
        g.fillStyle = pal.till; g.beginPath(); g.arc(cx, cz, 2.6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#2a1f3d'; g.lineWidth = 1.2; g.stroke();
      } else {
        g.fillStyle = pal.normal;
        g.beginPath(); g.arc(cx, cz, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
    // pings
    for (const pg of s.pings) {
      const col = s.players.find(p => p.id === pg.by)?.color ?? 0xffffff;
      g.strokeStyle = hex(col); g.lineWidth = 2;
      g.beginPath(); g.arc(this.X(pg.x), this.Z(pg.z), 5 + ((time * 10) % 5), 0, Math.PI * 2); g.stroke();
    }
    // teammates
    for (const p of s.players) {
      if (p.id === selfId) continue;
      g.globalAlpha = p.connected ? 1 : 0.4;
      this.arrow(p.x, p.z, p.yaw, hex(p.color), 4.5);
      g.globalAlpha = 1;
    }
    if (guide) {
      g.strokeStyle = '#ffd43b'; g.lineWidth = 2.5; g.setLineDash([3, 2]);
      g.beginPath(); g.arc(this.X(guide.x), this.Z(guide.z), 5 + Math.abs(Math.sin(time * 4)) * 4, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    this.arrow(self.x, self.z, self.yaw, '#ffffff', 6, true);
  }

  private arrow(x: number, z: number, yaw: number, color: string, size: number, outline = false) {
    const g = this.g;
    const cx = this.X(x), cz = this.Z(z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    g.beginPath();
    g.moveTo(cx + fx * size * 1.5, cz + fz * size * 1.5);
    g.lineTo(cx - fz * size * 0.9 - fx * size * 0.6, cz + fx * size * 0.9 - fz * size * 0.6);
    g.lineTo(cx + fz * size * 0.9 - fx * size * 0.6, cz - fx * size * 0.9 - fz * size * 0.6);
    g.closePath();
    g.fillStyle = color; g.fill();
    if (outline) { g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); }
  }
}
