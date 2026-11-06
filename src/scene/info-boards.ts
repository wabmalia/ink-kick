import * as THREE from 'three';
import { BOARD, farMiddleBoards, outline, PANEL_H, PANEL_W } from './ads';

// During a match, the two boards under the billboard give up their adverts
// to the match: how it's won on the left ("First to 3"), how it stands on
// the right ("2 to win", "Match point", the time left, "Golden goal"). Painted like the
// adverts, on faces laid just over theirs, so the baked boards stay as they
// are and show through again after the match.

const WASH = '#1f2552';
const INKS = ['#ffc53d', '#fff4e0'];

class InfoBoard {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private shown: string | null = null;

  constructor(at: THREE.Vector3, private ink: string) {
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 16;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.len, BOARD.h), new THREE.MeshBasicMaterial({ map: this.texture }));
    // A hair in front of the advert it covers.
    this.mesh.position.copy(at).add(new THREE.Vector3(0, 0, 0.015));
    this.mesh.visible = false;
  }

  set(text: string) {
    if (text === this.shown) return;
    this.shown = text;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = WASH;
    ctx.fillRect(0, 0, PANEL_W, PANEL_H);
    // The same lifted and pooled pigment as the adverts.
    for (const [fx, fr, a] of [[0.2, 0.3, 0.14], [0.82, 0.3, -0.25], [0.5, 0.2, 0.08]] as const) {
      const x = fx * PANEL_W;
      const g = ctx.createRadialGradient(x, PANEL_H / 2, 0, x, PANEL_H / 2, fr * PANEL_W);
      g.addColorStop(0, a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PANEL_W, PANEL_H);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = PANEL_H * 0.78;
    ctx.font = `${size}px 'Caveat Brush', cursive`;
    const fit = (PANEL_W * 0.86) / ctx.measureText(text).width;
    if (fit < 1) size *= fit;
    ctx.font = `${size}px 'Caveat Brush', cursive`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = outline(this.ink);
    ctx.strokeText(text, PANEL_W / 2, PANEL_H * 0.54);
    ctx.fillStyle = this.ink;
    ctx.fillText(text, PANEL_W / 2, PANEL_H * 0.54);
    this.texture.needsUpdate = true;
  }

  show(on: boolean) {
    this.mesh.visible = on;
  }

  // The font may still be loading the first time.
  repaint() {
    const text = this.shown;
    this.shown = null;
    if (text !== null) this.set(text);
  }
}

export class InfoBoards {
  readonly group = new THREE.Group();
  private boards: InfoBoard[];

  constructor() {
    this.boards = farMiddleBoards().map((at, i) => new InfoBoard(at, INKS[i]!));
    for (const b of this.boards) this.group.add(b.mesh);
    void document.fonts.load("80px 'Caveat Brush'").then(() => this.boards.forEach(b => b.repaint()));
  }

  /** The two lines to show, or null for the adverts. */
  set(info: [string, string] | null | undefined) {
    this.boards.forEach((b, i) => {
      b.show(!!info);
      if (info) b.set(info[i]!);
    });
  }
}
